export const sessionIdToUserRole = (sessionId: string) =>
  sessionId.charAt(0) === "0" ? 'an Admin in HomaGames (ie. Admin in Homa Team)' : sessionId.charAt(0) === "1" ? 'an Internal member of HomaGames (ie. the Homa team)' : 'External, not part of the Homa team / HomaGames';
