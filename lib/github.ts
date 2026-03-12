import "server-only";
import * as azdev from "azure-devops-node-api";
import type { IGitApi } from "azure-devops-node-api/GitApi";

import { env } from "@/lib/env";

interface PullData {
  base: { ref: string };
  head: { ref: string };
}

interface RepoData {
  archived: boolean;
}

interface InstallationData {
  permissions: {
    contents: "read" | "write";
  };
}

export interface InstallationClient {
  auth: (_: { type: "installation" }) => Promise<{ token: string }>;
  rest: {
    apps: {
      getInstallation: () => Promise<{
        data: InstallationData;
      }>;
    };
    pulls: {
      get: (params: {
        owner: string;
        pull_number: number;
        repo: string;
      }) => Promise<{ data: PullData }>;
    };
    repos: {
      get: (_: { owner: string; repo: string }) => Promise<{ data: RepoData }>;
      getBranchProtection: (_: {
        branch: string;
        owner: string;
        repo: string;
      }) => Promise<{
        data: { restrictions?: { apps?: { slug?: string }[] } };
      }>;
    };
  };
}

let connection: azdev.WebApi | null = null;
let gitApiPromise: Promise<IGitApi> | null = null;

const normalizeRefName = (refName: string | undefined): string =>
  refName?.replace("refs/heads/", "") ?? "";

const parseRepoFullName = (
  repoFullName: string
): { project: string; repo: string } => {
  const [projectOrOwner, repo] = repoFullName.split("/");
  if (!repo) {
    throw new Error(`Invalid repository format: "${repoFullName}"`);
  }

  const project = env.AZURE_DEVOPS_PROJECT || projectOrOwner;
  if (!project) {
    throw new Error("Missing AZURE_DEVOPS_PROJECT environment variable");
  }

  return {
    project,
    repo,
  };
};

export const getAzureRepoUrl = (repoFullName: string): string => {
  const { project, repo } = parseRepoFullName(repoFullName);
  const orgUrl = env.AZURE_DEVOPS_ORG_URL?.replace(/\/$/, "");
  if (!orgUrl) {
    throw new Error("Missing AZURE_DEVOPS_ORG_URL environment variable");
  }
  return `${orgUrl}/${project}/_git/${repo}`;
};

export const getGitHubApp = (): azdev.WebApi => {
  if (!connection) {
    if (!env.AZURE_DEVOPS_ORG_URL || !env.AZURE_DEVOPS_PAT) {
      throw new Error("Missing required Azure DevOps environment variables");
    }

    connection = new azdev.WebApi(
      env.AZURE_DEVOPS_ORG_URL,
      azdev.getPersonalAccessTokenHandler(env.AZURE_DEVOPS_PAT)
    );
  }

  return connection;
};

const getGitApi = (): Promise<IGitApi> => {
  if (!gitApiPromise) {
    const azureApp = getGitHubApp();
    gitApiPromise = azureApp.getGitApi();
  }

  return gitApiPromise;
};

const getAzurePat = (): string => {
  if (!env.AZURE_DEVOPS_PAT) {
    throw new Error("Missing AZURE_DEVOPS_PAT environment variable");
  }

  return env.AZURE_DEVOPS_PAT;
};

const createStatusError = (
  status: number,
  message: string
): Error & { status: number } => Object.assign(new Error(message), { status });

export const getInstallationOctokit = async (): Promise<InstallationClient> => {
  const gitApi = await getGitApi();

  return {
    auth: () => Promise.resolve().then(() => ({ token: getAzurePat() })),
    rest: {
      apps: {
        getInstallation: () =>
          Promise.resolve({
            data: {
              permissions: {
                contents: "write",
              },
            },
          }),
      },
      pulls: {
        get: async ({ owner, pull_number, repo }) => {
          const project = env.AZURE_DEVOPS_PROJECT || owner;
          const repository = await gitApi.getRepository(repo, project);
          if (!repository?.id) {
            throw new Error(`Repository ${project}/${repo} not found`);
          }

          const pullRequest = await gitApi.getPullRequest(
            repository.id,
            pull_number,
            project
          );

          return {
            data: {
              base: { ref: normalizeRefName(pullRequest.targetRefName) },
              head: { ref: normalizeRefName(pullRequest.sourceRefName) },
            },
          };
        },
      },
      repos: {
        get: async ({ owner, repo }) => {
          const project = env.AZURE_DEVOPS_PROJECT || owner;
          const repository = await gitApi.getRepository(repo, project);
          return {
            data: {
              archived: Boolean(repository?.isDisabled),
            },
          };
        },
        getBranchProtection: () => {
          return Promise.reject(
            createStatusError(
              404,
              "Branch protection checking is not supported for Azure DevOps repositories"
            )
          );
        },
      },
    },
  };
};

export const getAppInfo = (): {
  botUserId: number;
  slug: string;
} => ({ botUserId: -1, slug: env.AZURE_DEVOPS_BOT_NAME || "openreview" });
