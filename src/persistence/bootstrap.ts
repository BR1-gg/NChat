import { createRepository, type WorkspaceRepository } from './repository'

let repositoryPromise: Promise<WorkspaceRepository> | null = null

export function getRepository(): Promise<WorkspaceRepository> {
  repositoryPromise ??= createRepository()
  return repositoryPromise
}

export async function resetRepositoryForTests(): Promise<void> {
  repositoryPromise = null
}
