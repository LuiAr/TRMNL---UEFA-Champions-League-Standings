// UEFA Champions League league-phase standings.
//
// Source: https://standings.uefa.com/v1/standings (UEFA's own public API, no key).
// Slims a ~70 kB payload to ~5 kB and precomputes everything the Liquid views need.
//
// Zone codes: 1 = direct to round of 16 (1-8), 2 = knockout play-off (9-24), 3 = eliminated (25-36).
//
// Notes:
//  - UEFA reports tied ranks (two teams can both be "3"), so display position comes from
//    the array order, which is the official ordering. UEFA's own rank is kept as `ur`.
//  - No network calls here on purpose. The polling URL computes seasonYear from today's
//    date in Liquid, before the runtime runs, so season rollover costs nothing against the
//    5s transform budget.

function seasonLabel(year) {
  var y = parseInt(year, 10);
  if (!y) return '';
  return (y - 1) + '-' + String(y).slice(2);
}

function groupFrom(payload) {
  var arr = payload;
  if (arr && !Array.isArray(arr) && Array.isArray(arr.data)) arr = arr.data;
  if (!Array.isArray(arr) || !arr.length) return null;
  var g = arr[0];
  return g && Array.isArray(g.items) && g.items.length ? g : null;
}

function sign(n) {
  var v = typeof n === 'number' ? n : 0;
  return v > 0 ? '+' + v : String(v);
}

function zoneFor(pos) {
  if (pos <= 8) return 1;
  if (pos <= 24) return 2;
  return 3;
}

function build(group, favQuery) {
  var items = group.items;
  var teams = [];
  var matchday = 0;

  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var team = it.team || {};
    var tr = (team.translations || {}).displayOfficialName || {};
    var pos = i + 1;
    var played = it.played || 0;
    if (played > matchday) matchday = played;

    teams.push({
      r: pos,
      ur: it.rank || pos,
      t: team.internationalName || tr.EN || '',
      full: tr.EN || team.internationalName || '',
      a: team.teamCode || '',
      cc: team.countryCode || '',
      gp: played,
      w: it.won || 0,
      d: it.drawn || 0,
      l: it.lost || 0,
      gf: it.goalsFor || 0,
      ga: it.goalsAgainst || 0,
      gd: sign(it.goalDifference),
      pts: typeof it.points === 'number' ? it.points : 0,
      z: zoneFor(pos),
      live: it.isLive ? 1 : 0
    });
  }

  // Flag zone boundaries so views draw the cut lines from data.
  // `cuttop` marks the first row of a new zone, which suits a top border.
  for (var j = 0; j < teams.length; j++) {
    teams[j].cut = (j + 1 < teams.length && teams[j + 1].z !== teams[j].z) ? 1 : 0;
    teams[j].cuttop = (j > 0 && teams[j - 1].z !== teams[j].z) ? 1 : 0;
  }

  var pts8 = teams[7] ? teams[7].pts : 0;
  var pts24 = teams[23] ? teams[23].pts : 0;

  var fav = null;
  if (favQuery) {
    for (var k = 0; k < teams.length; k++) {
      var row = teams[k];
      if ((row.t + '|' + row.full + '|' + row.a).toLowerCase().indexOf(favQuery) !== -1) {
        fav = {
          r: row.r, t: row.t, full: row.full, a: row.a,
          gp: row.gp, w: row.w, d: row.d, l: row.l,
          gf: row.gf, ga: row.ga, gd: row.gd, pts: row.pts, z: row.z,
          d8: row.pts - pts8,
          d24: row.pts - pts24
        };
        break;
      }
    }
  }

  var seasonYear = group.group && group.group.seasonYear;
  var roundMeta = (group.round && group.round.metaData) || {};

  return {
    comp: 'UEFA Champions League',
    phase: roundMeta.name || 'League Phase',
    season: seasonLabel(seasonYear),
    official: group.status === 'OFFICIAL' ? 1 : 0,
    matchday: matchday,
    count: teams.length,
    pts8: pts8,
    pts24: pts24,
    teams: teams,
    fav: fav,
    fav_query: favQuery,
    fav_missing: favQuery && !fav ? 1 : 0
  };
}

function favFrom(input) {
  var settings = (input.trmnl && input.trmnl.plugin_settings) || {};
  var vals = settings.custom_fields_values || {};
  return String(vals.fav_team || '').trim().toLowerCase();
}

function run(input) {
  var favQuery = favFrom(input);

  // Primary path: whatever the poller retrieved.
  var group = groupFrom(input.data !== undefined ? input.data : input);
  if (group) return build(group, favQuery);

  // Never return an empty payload — that would blank the screen.
  // Prefer the last good data, else surface an explicit error state to the views.
  var prev = (input.trmnl && input.trmnl.previous_merge_variables) || null;
  if (prev && prev.teams && prev.teams.length) {
    prev.stale = 1;
    return prev;
  }
  return {
    comp: 'UEFA Champions League',
    phase: 'League Phase',
    count: 0,
    error: 1,
    error_message: 'Standings unavailable from UEFA right now'
  };
}

function transform(input) { return run(input); }
