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
    const compositeRef = claim.spec?.resourceRef;
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

    // Fetch composition revision information
    const compositionRef = xrData.spec?.compositionRef;
    let compositionRevision = null;
    let compositionRevisions = [];
    let composition = null;
    if (compositionRef) {
      try {
        console.log('Fetching composition with ref:', compositionRef);
        // Get the actual Composition resource
        const compositionPath = `/apis/apiextensions.crossplane.io/v1/compositions/${compositionRef.name}`;
        composition = await fetchResource(compositionPath);

        // Get all revisions
        const revisionsPath = `/apis/apiextensions.crossplane.io/v1/compositionrevisions`;
        const revisions = await fetchResource(revisionsPath);
        compositionRevisions = revisions?.items?.filter(rev => 
          rev.spec.compositionRef.name === compositionRef.name
        ) || [];

        // Get active revision
        const revisionPath = `/apis/apiextensions.crossplane.io/v1/compositionrevisions/${compositionRef.name}`;
        compositionRevision = await fetchResource(revisionPath);
      } catch (error) {
        console.warn('Failed to fetch composition or revision:', error);
      }
    }

    // Fetch package dependencies
    let packageDependencies = [];
    try {
      // Get all packages (providers, functions, configurations)
      const providers = await fetchResource('/apis/pkg.crossplane.io/v1/providers');
      const functions = await fetchResource('/apis/pkg.crossplane.io/v1/functions');
      const configurations = await fetchResource('/apis/pkg.crossplane.io/v1/configurations');

      packageDependencies = [
        ...(providers?.items || []),
        ...(functions?.items || []),
        ...(configurations?.items || [])
      ].map(pkg => ({
        ...pkg,
        dependencies: pkg.spec?.dependencies || [],
        runtime: pkg.spec?.runtime || null,
        packageType: pkg.kind.toLowerCase()
      }));
    } catch (error) {
      console.warn('Failed to fetch package dependencies:', error);
    }

    // Create a Set to track processed resources and avoid cycles
    const processedResources = new Set();
    
    // Helper function to fetch events for a resource
    async function fetchResourceEvents(resource) {
      try {
        const ns = resource.metadata?.namespace;
        // build the fieldSelector so we only get events for this object
        const fs = [
          `involvedObject.name=${resource.metadata.name}`,
          `involvedObject.kind=${resource.kind}`,
          `involvedObject.uid=${resource.metadata.uid}`
        ].join(',');

        const path = ns
          ? `/api/v1/namespaces/${ns}/events?fieldSelector=${fs}`
          : `/api/v1/events?fieldSelector=${fs}`;

        const events = await fetchResource(path);
        return events?.items || [];
      } catch (err) {
        console.warn('Failed to fetch events (falling back to empty list):', err);
        return [];
      }
    }

    // Helper function to process connection details
    function processConnectionDetails(resource) {
       // Only iterate if it really is an array
       const detailsArray = Array.isArray(resource.status?.connectionDetails)
         ? resource.status.connectionDetails
         : [];
      
       return detailsArray.map(detail => ({
         type: detail.type,
         name: detail.name,
         value: detail.value,
         ...(detail.sensitive && { sensitive: true })
      }));
    }

    // Recursive function to fetch a resource and its dependencies
    async function fetchResourceAndDependencies(ref, depth = 0, maxDepth = 10) {
      if (depth >= maxDepth) {
        console.warn('Max depth reached, stopping recursion');
        return null;
      }

      try {
        // Handle both object and string reference formats
        const resourceRef = typeof ref === 'string' ? ref : ref.name;
        const resourceKind = typeof ref === 'string' ? null : ref.kind;
        const resourceApiVersion = typeof ref === 'string' ? null : ref.apiVersion;
        const namespace = typeof ref === 'string' ? null : ref.namespace;

        if (!resourceRef) {
          console.warn('Invalid resource reference:', ref);
          return null;
        }

        // Create a unique identifier for the resource
        const resourceId = `${resourceKind}/${resourceApiVersion}/${namespace}/${resourceRef}`;
        if (processedResources.has(resourceId)) {
          console.log('Resource already processed:', resourceId);
          return null;
        }
        processedResources.add(resourceId);

        // Construct the resource path
        let path;
        if (resourceKind && resourceApiVersion) {
          const [group, version] = resourceApiVersion.split('/');
          const base   = resourceKind.toLowerCase();
          const plural = base.endsWith('s') ? base : base + 's';

          
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

        console.log('Fetching resource from:', path);
        const resource = await fetchResource(path);
        
        if (!resource) {
          console.warn('No resource returned for path:', path);
          return null;
        }

        // Fetch events for this resource
        const events = await fetchResourceEvents(resource);

        // Process connection details
        const connectionDetails = processConnectionDetails(resource);

        // Extract all possible references from the resource
        const refs = [];
        
        // Check spec.resourceRefs (common in XRs)
        if (Array.isArray(resource.spec.resourceRefs)) {
          refs.push(...resource.spec.resourceRefs);
        }        

        // Check status.resourceRefs (common in XRs)
        if (Array.isArray(resource.status?.resourceRefs)) {
          refs.push(...resource.status.resourceRefs);
        }

        // Check status.resources (older format)
        if (Array.isArray(resource.status?.resources)) {
          refs.push(...resource.status.resources);
        }

        // Check connectionDetails references
        if (Array.isArray(resource.status?.connectionDetails)) {
          const connectionRefs = resource.status.connectionDetails
            .filter(detail => detail.type === 'Reference')
            .map(detail => detail.value);
          refs.push(...connectionRefs);
        }

        // Check for direct references in status
        if (Array.isArray(resource.status?.resource?.refs)) {
          refs.push(...resource.status.resource.refs);
        }

        // Check for references in resource.references (dependency tracking)
        if (Array.isArray(resource.references)) {
          refs.push(...resource.references);
        }

        // Recursively fetch all referenced resources
        const dependencies = await Promise.all(
          refs
            .filter(Boolean)
            .map(ref => fetchResourceAndDependencies(ref, depth + 1, maxDepth))
        );

        // Filter out null dependencies and add them to the resource
        const validDependencies = dependencies.filter(Boolean);
        
        // Calculate propagated status based on dependencies
        const propagatedStatus = {
          ready: validDependencies.every(dep => 
            dep.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True'
          ),
          synced: validDependencies.every(dep => 
            dep.status?.conditions?.find(c => c.type === 'Synced')?.status === 'True'
          )
        };

        // Return enhanced resource information
        return {
          ...resource,
          dependencies: validDependencies,
          events,
          connectionDetails,
          propagatedStatus
        };
      } catch (error) {
        console.error('Error fetching resource:', error);
        return null;
      }
    }

    // Start with the composite resource and fetch all dependencies
    const traceResult = {
      claim,
      composite: xrData,
      composition: composition ? {
        ...composition,
        compositionRevision,
        compositionRevisions
      } : null,
      managedResources: []
    };

    // Extract and fetch all managed resources from the composite
    const managedRefs = [];
    if (Array.isArray(xrData.spec?.resourceRefs)) managedRefs.push(...xrData.spec.resourceRefs);
    if (Array.isArray(xrData.status?.resourceRefs)) managedRefs.push(...xrData.status.resourceRefs);
    if (Array.isArray(xrData.status?.resources)) managedRefs.push(...xrData.status.resources);
    if (Array.isArray(xrData.status?.resource?.refs)) managedRefs.push(...xrData.status.resource.refs);

    // Fetch all managed resources and their dependencies
    const managedResources = await Promise.all(
      managedRefs
        .filter(Boolean)
        .map(ref => fetchResourceAndDependencies(ref))
    );

    traceResult.managedResources = managedResources.filter(Boolean);

    // Add events and connection details for the claim and composite
    try {
      traceResult.claim.events = await fetchResourceEvents(claim);
      traceResult.composite.events = await fetchResourceEvents(xrData);
      if (composition) {
        traceResult.composition.events = await fetchResourceEvents(composition);
      }
      traceResult.composite.connectionDetails = processConnectionDetails(xrData);
    } catch (error) {
      console.warn('Failed to fetch events or connection details:', error);
    }

    return traceResult;
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