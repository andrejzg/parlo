/**
 * Copy for the two visibility states. Private is the default: you speak to
 * the agent in private and the agent reports back to the group. Open means
 * everyone in the group hears everyone, with names.
 *
 * Keep every sentence that explains who hears an answer in here so the
 * welcome, consent, dashboard and settings screens never drift apart.
 */

import type { GroupVisibility } from "@/types/survey";

export interface VisibilityCopy {
  /** Short label for badges and settings rows. */
  label: string;
  /** One line under a setting or on the welcome meta row. */
  short: string;
  /** The sentence the consent screen must show before anyone records. */
  consent: string;
  /** What the owner sees next to the toggle. */
  settingDescription: string;
}

export function visibilityCopy(visibility: GroupVisibility | undefined): VisibilityCopy {
  if (visibility === "open") {
    return {
      label: "Open group",
      short: "Everyone in the group hears everyone, with names.",
      consent:
        "This is an open group: everyone in it can hear your answers, with your name. The agent also uses them to write the group's report.",
      settingDescription: "Members hear each other's answers, with names. Applies to rounds from now on.",
    };
  }
  return {
    label: "Private",
    short: "You speak to the agent in private. It reports back to the group.",
    consent:
      "Your answers go to the organiser and the agent only. The group sees the agent's report, never your recording.",
    settingDescription: "Only you, your admins and the agent hear raw answers. Everyone gets the report.",
  };
}
