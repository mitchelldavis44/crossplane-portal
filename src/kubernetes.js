import { KubeConfig, CustomObjectsApi, CoreV1Api } from '@kubernetes/client-node';

// Initialize KubeConfig
const kc = new KubeConfig();
kc.loadFromDefault();

// Create API clients
const customObjectsApi = kc.makeApiClient(CustomObjectsApi);
const k8sApi = kc.makeApiClient(CoreV1Api);

export { k8sApi, customObjectsApi }; 