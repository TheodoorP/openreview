import { Sandbox } from "@vercel/sandbox";

import { parseError } from "@/lib/error";
import { getAzureRepoUrl } from "@/lib/github";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export const createSandbox = async (
  repoFullName: string,
  token: string,
  branch: string
): Promise<string> => {
  "use step";

  try {
    const sandbox = await Sandbox.create({
      source: {
        depth: 1,
        password: token,
        revision: branch,
        type: "git",
        url: getAzureRepoUrl(repoFullName),
        username: "openreview",
      },
      timeout: FIVE_MINUTES_MS,
    });

    return sandbox.sandboxId;
  } catch (error) {
    throw new Error(`Failed to create sandbox: ${parseError(error)}`, {
      cause: error,
    });
  }
};
