import tanstackEntry from "@tanstack/react-start/server-entry";
import { everyApp } from "@every-app/sdk/server";

// The Gateway validates the signed identity before application routing.
// No tools or public routes are exposed by this pilot.
export default everyApp<Env>(async (request) => tanstackEntry.fetch(request));
