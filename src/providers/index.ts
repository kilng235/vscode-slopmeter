import { IProvider, createProviderRegistry, ProviderRegistry } from './types'
import { OpenCodeProvider } from './opencode'
import { ClaudeProvider } from './claude'
import { HermesProvider } from './hermes'
import { ProviderId } from '../models'

let registry: ProviderRegistry | null = null
let extensionUri: string | undefined

export function setExtensionUri(uri: string) {
  extensionUri = uri
}

export function getProviderRegistry(): ProviderRegistry {
  if (!registry) {
    registry = createProviderRegistry()
    registry.register(new OpenCodeProvider(undefined, extensionUri))
    registry.register(new ClaudeProvider(undefined, extensionUri))
    registry.register(new HermesProvider(undefined, extensionUri))
  }
  return registry
}

export function refreshRegistry(customPaths: Record<string, string> = {}): void {
  registry = createProviderRegistry()
  registry.register(new OpenCodeProvider(customPaths.opencode, extensionUri))
  registry.register(new ClaudeProvider(customPaths.claude, extensionUri))
  registry.register(new HermesProvider(customPaths.hermes, extensionUri))
}

export function getProvider(id: ProviderId): IProvider | undefined {
  return getProviderRegistry().getProvider(id)
}

export function getAvailableProviders(): IProvider[] {
  return getProviderRegistry().getAvailableProviders()
}
