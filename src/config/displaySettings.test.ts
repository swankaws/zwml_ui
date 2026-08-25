import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  SETTINGS_ANCHOR,
  columnsPinnedByQuery,
  parseOrder,
  parseSettingsGrid,
  resolveSettings,
  settingsFromQuery,
} from './displaySettings'
import { league } from './league'

/** A SETTINGS tab as the maintainer would actually type it. */
const tab = (...rows: string[][]) => [[SETTINGS_ANCHOR], ...rows]

describe('parseSettingsGrid', () => {
  it('reads every supported key', () => {
    const { settings, warnings } = parseSettingsGrid(
      tab(['scale', '1.1'], ['columns', 'manager, left, maxBid'], ['rail', 'off'], ['perSlot', 'on']),
    )
    expect(settings).toEqual({
      scale: 1.1,
      columns: ['manager', 'left', 'maxBid'],
      rail: false,
      perSlot: true,
    })
    expect(warnings).toEqual([])
  })

  it('ignores the whole tab when the anchor is missing', () => {
    /*
     * The failure this guards is not hypothetical: 5.2 verified that gviz's
     * &sheet= selector answers status:"ok" with the WRONG TAB when the name does
     * not match. Without the anchor, a renamed SETTINGS tab hands this parser the
     * auction grid.
     */
    const { settings, warnings } = parseSettingsGrid([['Kevin', 'Pos'], ['scale', '1.9']])
    expect(settings).toEqual({})
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('anchor missing')
  })

  it('ignores an empty tab rather than treating it as "reset everything"', () => {
    expect(parseSettingsGrid([]).settings).toEqual({})
  })

  /*
   * A freshly created tab is empty, and stays empty between "create it so its gid can
   * be committed" and "fill it in" -- which is exactly the state the live workbook is
   * in as of 2026-08-25. Warning on every poll would train whoever is watching to
   * ignore warnings, on the one night they matter. A wrong tab is a different thing:
   * the auction grid is never blank.
   */
  it('does not warn about a blank tab: empty is not the same as wrong', () => {
    for (const blank of [[], [[]], [['']], [['', ''], ['  ', '']]]) {
      const { settings, warnings } = parseSettingsGrid(blank)
      expect(settings).toEqual({})
      expect(warnings).toEqual([])
    }
  })

  it('is position-independent, so blank and reordered rows are fine', () => {
    // This is what makes the tab safe to read over gviz, which drops empty rows.
    const { settings } = parseSettingsGrid(tab([], ['rail', 'off'], [], ['scale', '0.9']))
    expect(settings).toEqual({ scale: 0.9, rail: false })
  })

  it('accepts the spellings a human would use for on/off', () => {
    for (const on of ['on', 'ON', 'true', 'yes', '1', 'y']) {
      expect(parseSettingsGrid(tab(['perSlot', on])).settings.perSlot).toBe(true)
    }
    for (const off of ['off', 'FALSE', 'no', '0', 'n']) {
      expect(parseSettingsGrid(tab(['rail', off])).settings.rail).toBe(false)
    }
  })

  it('warns and ignores a value it cannot understand, leaving the default', () => {
    const { settings, warnings } = parseSettingsGrid(tab(['rail', 'maybe'], ['scale', 'big']))
    expect(settings).toEqual({})
    expect(warnings).toHaveLength(2)
  })

  it('clamps a wild scale instead of rejecting it', () => {
    // Someone typing 12 meant "much bigger", not "break the board".
    const { settings, warnings } = parseSettingsGrid(tab(['scale', '12']))
    expect(settings.scale).toBe(2)
    expect(warnings[0]).toContain('clamped')
  })

  it('ignores an unknown key with a warning rather than failing', () => {
    // Someone will leave a note in this tab. A note must not take the board down.
    const { settings, warnings } = parseSettingsGrid(
      tab(['note', 'remember to unmute the tv'], ['scale', '1.05']),
    )
    expect(settings).toEqual({ scale: 1.05 })
    expect(warnings[0]).toContain('unrecognized key')
  })

  it('rejects an unknown column name outright instead of silently dropping it', () => {
    const { settings, warnings } = parseSettingsGrid(tab(['columns', 'manager, maxbid, budget']))
    expect(settings.columns).toBeUndefined()
    expect(warnings[0]).toContain('budget')
  })

  it('puts the two protected columns back if a forced set omits them', () => {
    // 7.2: a board that cannot say who can bid what is not a board.
    const { settings, warnings } = parseSettingsGrid(tab(['columns', 'left, needs']))
    expect(settings.columns).toContain('manager')
    expect(settings.columns).toContain('maxBid')
    expect(warnings[0]).toContain('must include')
  })

  it('reads the nomination order, which is what the tab was invented for', () => {
    const { settings } = parseSettingsGrid(tab(['order', 'Jeff > Toby > Kevin']))
    expect(settings.order).toEqual(['Jeff', 'Toby', 'Kevin'])
  })
})

describe('parseOrder', () => {
  it('accepts the separators the sheet actually uses', () => {
    for (const raw of ['Kevin > Corky > Ryan', 'Kevin, Corky, Ryan', 'Kevin\nCorky\nRyan']) {
      expect(parseOrder(raw).order).toEqual(['Kevin', 'Corky', 'Ryan'])
    }
  })

  it('canonicalizes case and the Jeffrey alias', () => {
    expect(parseOrder('kevin > JEFFREY').order).toEqual(['Kevin', 'Jeff'])
  })

  it('rejects the whole order on one unknown name', () => {
    /*
     * Not "drop the bad name": a partial rotation is a wrong rotation, and a wall
     * that quietly skips a manager is worse than one using the committed copy.
     */
    const { order, warnings } = parseOrder('Kevin > Rob > Corky')
    expect(order).toBeNull()
    expect(warnings[0]).toContain('Rob')
  })

  it('rejects a duplicated name', () => {
    const { order, warnings } = parseOrder('Kevin > Corky > Kevin')
    expect(order).toBeNull()
    expect(warnings[0]).toContain('Kevin')
  })

  it('accepts a short order with a warning, since the board still works', () => {
    const { order, warnings } = parseOrder('Kevin > Corky')
    expect(order).toEqual(['Kevin', 'Corky'])
    expect(warnings[0]).toContain('2 of 12')
  })

  it('accepts all twelve managers with no warning at all', () => {
    const { order, warnings } = parseOrder(league.managers.join(' > '))
    expect(order).toEqual([...league.managers])
    expect(warnings).toEqual([])
  })

  it('treats an empty value as "not set" rather than an empty order', () => {
    expect(parseOrder('   ').order).toBeNull()
  })

  /*
   * The roster parameter is why a manager the committed config has never heard of can
   * be in the order without a deploy.
   *
   * This is not hypothetical any more: `Kris` replaced `Nick` four days before the
   * 2026 draft, and this is the path that carried it. `Kris` is in the committed
   * config now, so the test uses a *fresh* unknown name -- pinning the behaviour
   * rather than the one instance of it, so the next swap is covered too.
   */
  describe('validating against the roster rather than the committed list', () => {
    const swapped = league.managers.map((n) => (n === 'Colin' ? 'Newcomer' : n))

    it('accepts a name the committed config does not know, if the sheet has it', () => {
      const raw = 'Jeff > Toby > Tony > Derrick > Marc > Corky > Bill > Ryan > Newcomer > Kevin > Kris > Jason'

      // Against the committed roster this is the failure the maintainer would hit.
      expect(parseOrder(raw).order).toBeNull()
      expect(parseOrder(raw).warnings[0]).toContain('Newcomer')

      // Against the sheet's own roster it just works, with no warning.
      const { order, warnings } = parseOrder(raw, swapped)
      expect(order).toHaveLength(12)
      expect(order).toContain('Newcomer')
      expect(order).not.toContain('Colin')
      expect(warnings).toEqual([])
    })

    it('still rejects a name that is on neither list, so typos do not slip through', () => {
      const { order, warnings } = parseOrder('Kevin > Colin > Corky', swapped)
      expect(order).toBeNull()
      expect(warnings[0]).toContain('Colin')
    })

    it('counts a short order against the roster it was given, not against 12', () => {
      const { warnings } = parseOrder('Kevin > Corky', ['Kevin', 'Corky', 'Ryan'])
      expect(warnings[0]).toContain('2 of 3')
    })

    it('drops an alias whose target is not on the roster', () => {
      // `Jeffrey -> Jeff` must not smuggle Jeff in when Jeff is not playing.
      expect(parseOrder('Kevin > Jeffrey', ['Kevin', 'Corky']).order).toBeNull()
    })
  })
})

describe('settingsFromQuery', () => {
  it('needs no sheet, no network and no deploy', () => {
    const { settings } = settingsFromQuery('?scale=1.15&columns=manager,maxBid&rail=off')
    expect(settings).toEqual({ scale: 1.15, columns: ['manager', 'maxBid'], rail: false })
  })

  it('ignores unrelated query params', () => {
    // ?fixture= and ?year= belong to other layers and must not warn here.
    expect(settingsFromQuery('?fixture=2025').settings).toEqual({})
  })

  it('returns nothing for an empty query', () => {
    expect(settingsFromQuery('').settings).toEqual({})
  })
})

describe('columnsPinnedByQuery', () => {
  /*
   * Provenance decides whether a forced column set overrules the fit test, so this
   * one-line predicate is load-bearing: answer it wrong for the sheet and every phone
   * following along truncates; answer it wrong for the URL and the in-room escape
   * hatch stops working on the night it is needed.
   */
  it('is true only when the query itself carries columns', () => {
    expect(columnsPinnedByQuery('?columns=manager,maxBid')).toBe(true)
    expect(columnsPinnedByQuery('?scale=1.15&columns=manager,maxBid&rail=on')).toBe(true)
  })

  it('is false for a query that sets other keys, or nothing', () => {
    expect(columnsPinnedByQuery('?scale=1.15&rail=on')).toBe(false)
    expect(columnsPinnedByQuery('')).toBe(false)
    expect(columnsPinnedByQuery('?')).toBe(false)
  })

  it('does not care whether the value is usable', () => {
    // `?columns=nonsense` is still the operator reaching for the hatch; the parser
    // decides what to do with the value, and this only reports who spoke.
    expect(columnsPinnedByQuery('?columns=')).toBe(true)
    expect(columnsPinnedByQuery('?columns=budget')).toBe(true)
  })

  it('tolerates a search string with no leading question mark', () => {
    expect(columnsPinnedByQuery('columns=manager,maxBid')).toBe(true)
  })
})

describe('resolveSettings', () => {
  it('defaults to the priority system and a visible rail', () => {
    expect(resolveSettings()).toEqual(DEFAULT_SETTINGS)
    expect(resolveSettings().columns).toBeNull()
    expect(resolveSettings().rail).toBe(true)
  })

  it('lets the query beat the sheet, because the query is the in-room override', () => {
    const sheet = { scale: 0.9, rail: false }
    const query = { scale: 1.2 }
    expect(resolveSettings(sheet, query)).toMatchObject({ scale: 1.2, rail: false })
  })

  it('merges per key rather than replacing the whole object', () => {
    // A URL that pins scale must not silently re-enable a rail the sheet turned off.
    expect(resolveSettings({ rail: false }, { scale: 1.1 }).rail).toBe(false)
  })

  it('treats an absent key as "no opinion", not as false', () => {
    expect(resolveSettings({ rail: undefined }).rail).toBe(true)
  })
})
