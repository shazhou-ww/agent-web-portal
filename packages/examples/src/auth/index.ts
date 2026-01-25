/**
 * Auth module exports
 */

export { getAuthPageHtml, getAuthSuccessHtml } from "./ui.ts";
export {
  createClearSessionCookie,
  createSession,
  createSessionCookie,
  deleteSession,
  getSession,
  getSessionFromRequest,
  getSessionIdFromRequest,
  TEST_USERS,
  validateCredentials,
  type Session,
  type User,
} from "./session.ts";
