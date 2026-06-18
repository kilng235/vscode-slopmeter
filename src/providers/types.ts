import { UsageSummary, ProviderId } from '../models'

export interface IProvider {
  id: ProviderId
  name: string
  isAvailable(): boolean
  loadData(start: Date, end: Date): Promise<UsageSummary>
}

export interface ProviderRegistry {
  getProvider(id: ProviderId): IProvider | undefined
  getAllProviders(): IProvider[]
  getAvailableProviders(): IProvider[]
  register(provider: IProvider): void
}

export function createProviderRegistry(): ProviderRegistry {
  const providers = new Map<ProviderId, IProvider>()

  return {
    getProvider(id: ProviderId): IProvider | undefined {
      return providers.get(id)
    },
    getAllProviders(): IProvider[] {
      return Array.from(providers.values())
    },
    getAvailableProviders(): IProvider[] {
      return Array.from(providers.values()).filter(p => p.isAvailable())
    },
    register(provider: IProvider): void {
      providers.set(provider.id, provider)
    },
  }
}
