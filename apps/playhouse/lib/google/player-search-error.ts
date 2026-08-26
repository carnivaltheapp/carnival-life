import { GoogleAccountReconnectRequiredError } from "./token-broker";

export const PLAYER_RECONNECT_MESSAGE =
  "Google needs to be reconnected before Players can be searched. Sign out and sign in again.";

export function playerSearchErrorMessage(error: unknown) {
  return error instanceof GoogleAccountReconnectRequiredError
    ? PLAYER_RECONNECT_MESSAGE
    : "Players could not be searched right now. Please try again.";
}
