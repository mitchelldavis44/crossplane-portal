// Access the exposed API from the preload script
const api = window.api;

export async function getKubeConfig() {
  return api.getKubeConfig();
}

export async function setContext(contextName) {
  return api.setContext(contextName);
}

export async function fetchResource(path, method = 'GET', body = undefined) {
  try {
    console.log(`Fetching resource: ${path}, method: ${method}`);
    const response = await api.k8sApi({ path, method, body });
    
    // Log the raw response for debugging
    console.log('Raw API response:', response);
    
    // Handle null or undefined response
    if (!response) {
      console.error('Received null or undefined response from API');
      throw new Error('No response received from API');
    }
    
    if (response.error) {
      console.error('API error:', response.error);
      const errorDetails = {
        message: response.error || 'Unknown error',
        details: response.details || null,
        code: response.code || undefined,
        statusCode: response.statusCode || undefined
      };
      console.error('Error details:', errorDetails);
      throw new Error(response.error + (response.details ? `: ${response.details}` : ''));
    }
    
    // Check if response has a data property
    if (!response.data) {
      console.error('No data in response:', response);
      throw new Error('No data received from API');
    }

    // Validate response data
    if (typeof response.data === 'string') {
      if (response.data.startsWith('<!DOCTYPE')) {
        console.error('Received HTML response instead of JSON');
        throw new Error('Invalid response format: received HTML instead of JSON');
      }
      try {
        // Try to parse if it's a JSON string
        return JSON.parse(response.data);
      } catch (err) {
        console.error('Failed to parse response data:', err);
        throw new Error('Invalid JSON response from API');
      }
    }
    
    return response.data;
  } catch (error) {
    console.error(`Failed to fetch resource from ${path}:`, error);
    
    // Handle specific error cases
    if (error.response) {
      const statusCode = error.response.statusCode;
      const statusMessage = error.response.statusMessage;
      
      // Handle 404 Not Found specifically
      if (statusCode === 404) {
        console.log(`Resource not found at ${path}`);
        return null; // Return null instead of throwing for 404s
      }
      
      // Handle other common error cases
      if (statusCode === 401) {
        throw new Error('Unauthorized: Please check your Kubernetes credentials');
      } else if (statusCode === 403) {
        throw new Error('Forbidden: You don\'t have permission to access this resource');
      } else if (statusCode >= 500) {
        throw new Error(`Server error (${statusCode}): ${statusMessage}`);
      }
      
      console.error('Response error details:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
    }
    
    // For other errors, throw with the original message
    throw error;
  }
}

export async function fetchCompositeResources() {
  try {
    console.log('Fetching composite resources...');
    
    // First, get all XRDs
    const xrds = await fetchResource('/apis/apiextensions.crossplane.io/v1/compositeresourcedefinitions');
    if (!xrds) {
      console.log('No XRDs found');
      return [];
    }
    
    console.log('Fetched XRDs:', xrds);
    
    // Then, for each XRD, get its claims
    const resources = [];
    for (const xrd of xrds.items || []) {
      const group = xrd.spec.group;
      const version = xrd.spec.versions[0].name;
      const claimNames = xrd.spec.claimNames;
      
      if (claimNames && claimNames.kind) {
        try {
          console.log(`Fetching claims for ${claimNames.kind} from ${group}/${version}/${claimNames.plural}`);
          const claims = await fetchResource(`/apis/${group}/${version}/${claimNames.plural}`);
          
          // Skip if no claims found
          if (!claims) {
            console.log(`No claims found for ${claimNames.kind}`);
            continue;
          }
          
          console.log(`Fetched claims for ${claimNames.kind}:`, claims);
          
          resources.push(...(claims.items || []).map(claim => ({
            ...claim,
            claimNamespace: claim.metadata.namespace
          })));
        } catch (error) {
          // Log the error but continue processing other XRDs
          console.warn(`Failed to fetch claims for ${claimNames.kind}:`, error);
          continue;
        }
      }
    }
    
    console.log('Final composite resources:', resources);
    return resources;
  } catch (error) {
    console.error('Failed to fetch composite resources:', error);
    throw error;
  }
}

export async function fetchResourceTrace(claim) {
  if (!claim) return null;

  try {
    console.log('Fetching resource trace for claim:', claim);
    
    // Get the composite resource name from the claim
    const compositeRef = claim.spec?.resourceRef || claim.spec?.compositeRef;
    if (!compositeRef) {
      throw new Error('No composite resource reference found in claim');
    }

    // Fetch the composite resource (XR)
    const xrPlural = compositeRef.kind.toLowerCase() + 's';
    const xrPath = `/apis/${compositeRef.apiVersion}/${xrPlural}/${compositeRef.name}`;
    console.log('Fetching composite resource from:', xrPath);
    const xrData = await fetchResource(xrPath);

    if (!xrData) {
      throw new Error(`Failed to fetch composite resource ${compositeRef.kind}/${compositeRef.name}`);
    }

    // Extract managed resource references
    const managedRefs = [];
    
    // Check all possible locations for managed resource references
    if (xrData.spec?.resourceRefs) {
      managedRefs.push(...xrData.spec.resourceRefs);
    }
    if (xrData.resourceRefs) {
      managedRefs.push(...xrData.resourceRefs);
    }
    if (xrData.status?.resources) {
      managedRefs.push(...xrData.status.resources);
    }
    if (xrData.status?.resourceRefs) {
      managedRefs.push(...xrData.status.resourceRefs);
    }
    if (xrData.status?.resource?.refs) {
      managedRefs.push(...xrData.status.resource.refs);
    }

    console.log('Found managed resource refs:', managedRefs);

    // Fetch all managed resources
    const managedResources = await Promise.all(managedRefs.filter(Boolean).map(async (ref) => {
      try {
        // Handle both object and string reference formats
        const resourceRef = typeof ref === 'string' ? ref : ref.name;
        const resourceKind = typeof ref === 'string' ? null : ref.kind;
        const resourceApiVersion = typeof ref === 'string' ? null : ref.apiVersion;

        if (!resourceRef) {
          console.warn('Invalid resource reference:', ref);
          return null;
        }

        // Construct the resource path
        let path;
        if (resourceKind && resourceApiVersion) {
          const [group, version] = resourceApiVersion.split('/');
          const namespace = ref.namespace;
          const plural = resourceKind.toLowerCase() + 's';
          
          // Try cluster-scoped path first for AWS resources
          if (group.includes('aws')) {
            path = `/apis/${group}/${version}/${plural}/${resourceRef}`;
          } else {
            path = namespace
              ? `/apis/${group}/${version}/namespaces/${namespace}/${plural}/${resourceRef}`
              : `/apis/${group}/${version}/${plural}/${resourceRef}`;
          }
        } else if (typeof ref === 'string') {
          path = ref;
        }

        if (!path) {
          console.warn('Could not construct path for resource:', ref);
          return null;
        }

        console.log('Fetching managed resource from:', path);
        const resource = await fetchResource(path);
        
        if (!resource) {
          console.warn('No resource returned for path:', path);
          return null;
        }

        return resource;
      } catch (error) {
        console.error('Failed to fetch managed resource:', error);
        return null;
      }
    }));

    return {
      claim,
      composite: xrData,
      managedResources: managedResources.filter(Boolean)
    };
  } catch (error) {
    console.error('Failed to fetch resource trace:', error);
    throw error;
  }
}

export async function fetchSpecificClaim(kind, name, namespace) {
  try {
    console.log(`Fetching specific claim: ${kind}/${name} in namespace ${namespace}`);
    
    // Find the XRD for this claim kind
    const xrds = await fetchResource('/apis/apiextensions.crossplane.io/v1/compositeresourcedefinitions');
    const xrd = xrds.items.find(xrd => xrd.spec.claimNames?.kind === kind);
    
    if (!xrd) {
      throw new Error(`No XRD found for claim kind ${kind}`);
    }
    
    const group = xrd.spec.group;
    const version = xrd.spec.versions[0].name;
    const plural = xrd.spec.claimNames.plural;
    
    const path = namespace 
      ? `/apis/${group}/${version}/namespaces/${namespace}/${plural}/${name}`
      : `/apis/${group}/${version}/${plural}/${name}`;
    
    const claim = await fetchResource(path);
    return {
      ...claim,
      claimNamespace: namespace
    };
  } catch (error) {
    console.error(`Failed to fetch specific claim ${kind}/${name}:`, error);
    throw error;
  }
} 