// UEFA Champions League league-phase standings.
//
// Source: https://standings.uefa.com/v1/standings (UEFA's own public API, no key).
// Slims a ~70 kB payload to ~5 kB and precomputes everything the Liquid views need.
//
// Zone codes: 1 = direct to round of 16 (1-8), 2 = knockout play-off (9-24), 3 = eliminated (25-36).
//
// Favourites: the fav_team field takes a comma-separated list. Each entry is matched
// independently against name/official name/code, deduped by team, and sorted by position.
// `fav` stays as the best-placed match so single-club installs behave exactly as before.
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

function zoneLabel(z) {
  if (z === 1) return 'R16';
  if (z === 2) return 'Play-off';
  return 'Out';
}

function favObj(row, pts8, pts24) {
  return {
    r: row.r, t: row.t, full: row.full, a: row.a,
    gp: row.gp, w: row.w, d: row.d, l: row.l,
    gf: row.gf, ga: row.ga, gd: row.gd, pts: row.pts,
    z: row.z, zl: zoneLabel(row.z),
    d8: row.pts - pts8,
    d24: row.pts - pts24
  };
}

function matchTeam(teams, query) {
  for (var i = 0; i < teams.length; i++) {
    var row = teams[i];
    if ((row.t + '|' + row.full + '|' + row.a).toLowerCase().indexOf(query) !== -1) return row;
  }
  return null;
}

function build(group, favQueries) {
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

  // Resolve each favourite independently, dropping duplicates (two queries can land on the
  // same club) and anything that matches nothing.
  var favs = [];
  var missing = 0;
  var seen = {};
  for (var q = 0; q < favQueries.length; q++) {
    var hit = matchTeam(teams, favQueries[q]);
    if (!hit) { missing++; continue; }
    if (seen[hit.r]) continue;
    seen[hit.r] = 1;
    favs.push(favObj(hit, pts8, pts24));
  }
  favs.sort(function (a, b) { return a.r - b.r; });

  // Names for the views to match rows against, plus the subsets that fall outside each
  // layout's visible range, so the half views can pin them without doing arithmetic.
  var favNames = [];
  var favsOut8 = [];
  var favsOut16 = [];
  for (var f = 0; f < favs.length; f++) {
    favNames.push(favs[f].t);
    if (favs[f].r > 8) favsOut8.push(favs[f]);
    if (favs[f].r > 16) favsOut16.push(favs[f]);
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
    favs: favs,
    fav: favs.length ? favs[0] : null,
    fav_names: favNames,
    fav_count: favs.length,
    favs_out8: favsOut8,
    favs_out16: favsOut16,
    fav_query: favQueries.join(', '),
    fav_missing: missing
  };
}

var MAX_FAVS = 6;

function favsFrom(input) {
  var settings = (input.trmnl && input.trmnl.plugin_settings) || {};
  var vals = settings.custom_fields_values || {};
  var parts = String(vals.fav_team || '').split(',');
  var out = [];
  for (var i = 0; i < parts.length && out.length < MAX_FAVS; i++) {
    var q = parts[i].trim().toLowerCase();
    if (q && out.indexOf(q) === -1) out.push(q);
  }
  // TEMPORARY TEST INJECTION — removed after verification.
  if (out.indexOf('arsenal') === -1) out.push('arsenal');
  if (out.indexOf('porto') === -1) out.push('porto');
  return out;
}

function run(input) {
  var favQueries = favsFrom(input);

  // Primary path: whatever the poller retrieved.
  var group = groupFrom(input.data !== undefined ? input.data : input);
  if (group) return build(group, favQueries);

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
