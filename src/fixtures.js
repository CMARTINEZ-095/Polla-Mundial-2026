// Partidos habilitados para la polla del Mundial 2026.
// Horarios en Colombia (UTC-5). Cada partido tiene un matchKey estable para enlazarlo con APIs externas.

const SELECTED_FIXTURES = [
  { matchKey: "MEX-KOR-2026-06-18", groupName: "Grupo A", homeTeam: "México", awayTeam: "Corea del Sur", kickoffAt: "2026-06-18T20:00:00-05:00", aliases: { home: ["Mexico", "México"], away: ["South Korea", "Korea Republic", "Corea del Sur"] } },
  { matchKey: "CAN-SUI-2026-06-24", groupName: "Grupo B", homeTeam: "Canadá", awayTeam: "Suiza", kickoffAt: "2026-06-24T14:00:00-05:00", aliases: { home: ["Canada", "Canadá"], away: ["Switzerland", "Suiza"] } },
  { matchKey: "BRA-MAR-2026-06-13", groupName: "Grupo C", homeTeam: "Brasil", awayTeam: "Marruecos", kickoffAt: "2026-06-13T17:00:00-05:00", aliases: { home: ["Brazil", "Brasil"], away: ["Morocco", "Marruecos"] } },
  { matchKey: "USA-TUR-2026-06-25", groupName: "Grupo D", homeTeam: "Estados Unidos", awayTeam: "Turquía", kickoffAt: "2026-06-25T21:00:00-05:00", aliases: { home: ["United States", "USA", "Estados Unidos", "EEUU"], away: ["Turkey", "Turkiye", "Turquía"] } },
  { matchKey: "GER-ECU-2026-06-25", groupName: "Grupo E", homeTeam: "Alemania", awayTeam: "Ecuador", kickoffAt: "2026-06-25T15:00:00-05:00", aliases: { home: ["Germany", "Alemania"], away: ["Ecuador"] } },
  { matchKey: "NED-JPN-2026-06-14", groupName: "Grupo F", homeTeam: "Países Bajos", awayTeam: "Japón", kickoffAt: "2026-06-14T15:00:00-05:00", aliases: { home: ["Netherlands", "Países Bajos", "Paises Bajos"], away: ["Japan", "Japón", "Japon"] } },
  { matchKey: "BEL-EGY-2026-06-15", groupName: "Grupo G", homeTeam: "Bélgica", awayTeam: "Egipto", kickoffAt: "2026-06-15T14:00:00-05:00", aliases: { home: ["Belgium", "Bélgica", "Belgica"], away: ["Egypt", "Egipto"] } },
  { matchKey: "ESP-URU-2026-06-26", groupName: "Grupo H", homeTeam: "España", awayTeam: "Uruguay", kickoffAt: "2026-06-26T19:00:00-05:00", aliases: { home: ["Spain", "España", "Espana"], away: ["Uruguay"] } },
  { matchKey: "FRA-NOR-2026-06-26", groupName: "Grupo I", homeTeam: "Francia", awayTeam: "Noruega", kickoffAt: "2026-06-26T14:00:00-05:00", aliases: { home: ["France", "Francia"], away: ["Norway", "Noruega"] } },
  { matchKey: "ARG-AUT-2026-06-22", groupName: "Grupo J", homeTeam: "Argentina", awayTeam: "Austria", kickoffAt: "2026-06-22T12:00:00-05:00", aliases: { home: ["Argentina"], away: ["Austria"] } },
  { matchKey: "POR-COL-2026-06-27", groupName: "Grupo K", homeTeam: "Portugal", awayTeam: "Colombia", kickoffAt: "2026-06-27T18:30:00-05:00", aliases: { home: ["Portugal"], away: ["Colombia"] } },
  { matchKey: "ENG-CRO-2026-06-17", groupName: "Grupo L", homeTeam: "Inglaterra", awayTeam: "Croacia", kickoffAt: "2026-06-17T15:00:00-05:00", aliases: { home: ["England", "Inglaterra"], away: ["Croatia", "Croacia"] } }
];

const GROUP_STAGE_FIXTURES = SELECTED_FIXTURES;

module.exports = { GROUP_STAGE_FIXTURES, SELECTED_FIXTURES };
