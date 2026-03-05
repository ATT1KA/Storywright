import registry from './semantic_registry.json' assert { type: 'json' };

export function getSemanticRegistry() {
  return registry;
}

export function getSemanticContract(contractId) {
  return registry.contracts?.[contractId] || null;
}

export function hasSemanticContract(contractId) {
  return Boolean(registry.contracts?.[contractId]);
}
