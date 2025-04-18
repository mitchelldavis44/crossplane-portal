import { useEffect, useState, useCallback, useMemo } from 'react';
import ReactFlow, { Background, Controls, MiniMap, Handle } from 'reactflow';
import 'reactflow/dist/style.css';
import { getKubeConfig, setContext, fetchCompositeResources, fetchResource } from './services/k8sService';
import yaml from 'js-yaml';
import TitleBar from './components/TitleBar';

// Helper function to convert JSON to YAML - we use this for displaying resource details
const toYAML = (obj) => {
  try {
    return yaml.dump(obj, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false
    });
  } catch (error) {
    console.error('Error converting to YAML:', error);
    return JSON.stringify(obj, null, 2);
  }
};

const ResourceDetailsPanel = ({ resource, onClose }) => {
  if (!resource) return null;
  
  return (
    <div className="resource-details-panel">
      <div className="panel-header">
        <h3>Resource Details</h3>
        <button onClick={onClose} className="hover:bg-gray-100 rounded-lg p-1">
          <svg className="w-5 h-5 text-gray-500" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
      <div className="space-y-4">
        <div>
          <h4 className="text-sm font-medium text-gray-500 mb-2">Status</h4>
          <div className="flex gap-2">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              resource.data.synced ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}>
              {resource.data.synced ? 'Synced' : 'Not Synced'}
            </span>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              resource.data.ready ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}>
              {resource.data.ready ? 'Ready' : 'Not Ready'}
            </span>
          </div>
        </div>
        <div>
          <h4 className="text-sm font-medium text-gray-500 mb-2">Resource YAML</h4>
          <div className="bg-gray-50 rounded-lg border border-gray-200 max-h-[500px] overflow-auto">
            <pre className="p-4 text-sm text-gray-700 font-mono whitespace-pre">
              {toYAML(resource.data.resourceData)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};

// Custom node component for the graph visualization
const CustomNode = ({ data, id, selected }) => {
  // Get the appropriate color based on resource status
  const getStatusColor = () => {
    if (data.ready && data.synced) return '#22c55e'; // green
    if (!data.ready && !data.synced) return '#ef4444'; // red
    return '#f59e0b'; // yellow for partial success
  };

  return (
    <div 
      style={{
        padding: '12px 16px',
        paddingRight: '24px',
        borderRadius: '8px',
        background: 'white',
        border: `1px solid ${selected ? '#3b82f6' : '#e2e8f0'}`,
        boxShadow: selected ? '0 4px 6px -1px rgba(59, 130, 246, 0.1), 0 2px 4px -1px rgba(59, 130, 246, 0.06)' : '0 1px 3px rgba(0, 0, 0, 0.1)',
        position: 'relative',
        minWidth: '200px',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        fontSize: '14px',
        color: '#1f2937'
      }}
    >
      {/* Status indicator dot */}
      <div 
        style={{ 
          position: 'absolute',
          top: '12px',
          right: '8px',
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: getStatusColor()
        }}
      />

      {/* Resource label */}
      <div style={{ 
        maxWidth: 'calc(100% - 20px)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }}>
        {data.label}
      </div>

      <Handle type="target" position="top" style={{ visibility: 'hidden' }} />
      <Handle type="source" position="bottom" style={{ visibility: 'hidden' }} />
    </div>
  );
};

const GraphView = ({ traceData }) => {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedNode, setSelectedNode] = useState(null);

  const nodeTypes = useMemo(() => ({
    custom: CustomNode
  }), []);

  const onNodeClick = useCallback((event, clickedNode) => {
    console.log('Node clicked:', clickedNode);
    event.preventDefault();
    event.stopPropagation();
    
    let resourceData;
    if (clickedNode.id === 'claim') {
      resourceData = traceData.claim;
    } else if (clickedNode.id === 'composite') {
      resourceData = traceData.composite;
    } else if (clickedNode.id.startsWith('managed-')) {
      const index = parseInt(clickedNode.id.split('-')[1]);
      resourceData = traceData.managedResources[index];
    }

    console.log('Setting selected node with resource data:', resourceData);
    setSelectedNode(prev => prev?.id === clickedNode.id ? null : { ...clickedNode, resourceData });
  }, [traceData]);

  useEffect(() => {
    if (!traceData) {
      console.log('No trace data available');
      return;
    }

    console.log('Rendering graph with trace data:', traceData);
    const newNodes = [];
    const newEdges = [];
    
    const centerX = 400;
    const verticalSpacing = 120; // Increased vertical spacing between levels
    
    // Add claim node if it exists and has required fields
    if (traceData.claim && traceData.claim.kind && traceData.claim.metadata?.name) {
      newNodes.push({
        id: 'claim',
        type: 'custom',
        position: { x: centerX, y: 50 },
        data: { 
          label: `${traceData.claim.kind}/${traceData.claim.metadata.name}`,
          synced: traceData.claim.status?.conditions?.find(c => c.type === 'Synced')?.status === 'True',
          ready: traceData.claim.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True',
          resourceData: traceData.claim
        }
      });
    }

    // Add composite node if it exists and has required fields
    if (traceData.composite && traceData.composite.kind && traceData.composite.metadata?.name) {
      const compositeId = 'composite';
      newNodes.push({
        id: compositeId,
        type: 'custom',
        position: { x: centerX, y: 50 + verticalSpacing }, // Position below claim
        data: { 
          label: `${traceData.composite.kind}/${traceData.composite.metadata.name}`,
          synced: traceData.composite.status?.conditions?.find(c => c.type === 'Synced')?.status === 'True',
          ready: traceData.composite.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True',
          resourceData: traceData.composite
        }
      });

      // Add edge from claim to composite if both exist
      if (newNodes.find(n => n.id === 'claim')) {
        newEdges.push({
          id: 'edge-claim-composite',
          source: 'claim',
          target: compositeId,
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#6366f1' }
        });
      }

      // Add managed resources if they exist
      if (Array.isArray(traceData.managedResources) && traceData.managedResources.length > 0) {
        const validResources = traceData.managedResources.filter(resource => 
          resource && resource.kind && resource.metadata?.name
        );
        
        const horizontalSpacing = 300; // Increased horizontal spacing between managed resources
        const totalWidth = (validResources.length - 1) * horizontalSpacing;
        const startX = centerX - (totalWidth / 2);
        
        validResources.forEach((resource, index) => {
          const resourceId = `managed-${index}`;
          const xPos = startX + (index * horizontalSpacing);
          const yPos = 50 + (verticalSpacing * 2); // Position below composite

          newNodes.push({
            id: resourceId,
            type: 'custom',
            position: { x: xPos, y: yPos },
            data: { 
              label: `${resource.kind}/${resource.metadata.name}`,
              synced: resource.status?.conditions?.find(c => c.type === 'Synced')?.status === 'True',
              ready: resource.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True',
              resourceData: resource
            }
          });

          // Add edge from composite to managed resource
          newEdges.push({
            id: `edge-composite-${resourceId}`,
            source: compositeId,
            target: resourceId,
            type: 'smoothstep',
            animated: true,
            style: { stroke: '#8b5cf6' }
          });

          // Add dependency edges if they exist and are valid
          if (Array.isArray(resource.references)) {
            resource.references.forEach(ref => {
              if (!ref || !ref.kind || !ref.name) return;
              
              const depIndex = validResources.findIndex(r => 
                r.kind === ref.kind && r.metadata?.name === ref.name
              );
              
              if (depIndex !== -1) {
                newEdges.push({
                  id: `edge-${resourceId}-managed-${depIndex}`,
                  source: `managed-${depIndex}`,
                  target: resourceId,
                  type: 'smoothstep',
                  animated: false,
                  style: { 
                    stroke: '#94a3b8',
                    strokeDasharray: '5,5'
                  },
                  label: 'depends on'
                });
              }
            });
          }
        });
      }
    }

    console.log('Setting nodes:', newNodes);
    console.log('Setting edges:', newEdges);
    setNodes(newNodes);
    setEdges(newEdges);
  }, [traceData]);

  return (
    <div className="graph-container" style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ 
          padding: 0.5,
          minZoom: 0.5,
          maxZoom: 1.5
        }}
        minZoom={0.5}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        defaultEdgeOptions={{
          type: 'smoothstep',
          style: { stroke: '#94a3b8' }
        }}
        style={{
          background: 'rgb(249, 250, 251)',
          transition: 'margin-right 0.3s ease-in-out',
          marginRight: selectedNode ? '400px' : '0'
        }}
      >
        <Background gap={24} />
        <Controls 
          position="bottom-right"
          style={{ bottom: 40, right: selectedNode ? '440px' : '40px' }}
        />
        <MiniMap 
          position="bottom-left"
          style={{ bottom: 40, left: 40 }}
          nodeColor={node => {
            return node.data.ready && node.data.synced ? '#22c55e' : '#ef4444';
          }}
        />
      </ReactFlow>
      {selectedNode && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: '400px',
            background: 'white',
            boxShadow: '-2px 0 5px rgba(0,0,0,0.1)',
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">Resource Details</h3>
            <button 
              onClick={() => setSelectedNode(null)}
              className="rounded-lg p-2 hover:bg-gray-100 transition-colors"
            >
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="space-y-6">
              {/* Status Section */}
              <div>
                <h4 className="text-sm font-medium text-gray-500 mb-3">Status</h4>
                <div className="space-y-3">
                  {selectedNode.data.resourceData?.status?.conditions?.map((condition, index) => (
                    <div key={index} className="bg-gray-50 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <div className={`w-2 h-2 rounded-full ${condition.status === 'True' ? 'bg-green-500' : 'bg-red-500'}`} />
                        <span className="font-medium">{condition.type}</span>
                        <span className={`text-sm ${condition.status === 'True' ? 'text-green-600' : 'text-red-600'}`}>
                          {condition.status}
                        </span>
                      </div>
                      {condition.message && (
                        <div className="text-sm text-gray-600 mt-1">{condition.message}</div>
                      )}
                      {condition.lastTransitionTime && (
                        <div className="text-xs text-gray-400 mt-1">
                          Last Updated: {new Date(condition.lastTransitionTime).toLocaleString()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Resource YAML */}
              <div>
                <h4 className="text-sm font-medium text-gray-500 mb-3">Resource YAML</h4>
                <div className="bg-gray-50 rounded-lg border border-gray-200 overflow-auto">
                  <pre className="p-4 text-sm text-gray-700 font-mono whitespace-pre">
                    {toYAML(selectedNode.data.resourceData)}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Add the YAML modal component
const YAMLModal = ({ resource, onClose }) => {
  if (!resource) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="text-lg font-medium text-gray-900">
            {resource.kind}/{resource.metadata.name}
          </h3>
          <button 
            onClick={onClose}
            className="rounded-lg p-2 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-auto p-6">
          <pre className="bg-gray-50 rounded-lg p-4 text-sm font-mono text-gray-800 whitespace-pre">
            {toYAML(resource)}
          </pre>
        </div>
      </div>
    </div>
  );
};

const ResourceRow = ({ resource, depth = 0, isLast = false }) => {
  const [showYAML, setShowYAML] = useState(false);

  return (
    <>
      <div 
        className="px-4 py-2 grid grid-cols-[300px,100px,100px,1fr] items-center gap-4 hover:bg-white group cursor-pointer"
        onClick={() => setShowYAML(true)}
      >
        <div className="truncate text-gray-600 flex items-center">
          <span className="font-mono whitespace-pre">{depth > 0 ? (isLast ? '└─ ' : '├─ ') : ''}</span>
          <span>{resource.kind}/{resource.metadata.name}</span>
        </div>
        <div className={`text-center ${resource.status?.conditions?.find(c => c.type === 'Synced')?.status === 'True' ? 'text-green-600' : 'text-red-600'}`}>
          {resource.status?.conditions?.find(c => c.type === 'Synced')?.status || '-'}
        </div>
        <div className={`text-center ${resource.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True' ? 'text-green-600' : 'text-red-600'}`}>
          {resource.status?.conditions?.find(c => c.type === 'Ready')?.status || '-'}
        </div>
        <div className="text-gray-900 break-words">
          {resource.status?.conditions?.find(c => c.type === 'Ready')?.message || 
           resource.status?.conditions?.find(c => c.type === 'Synced')?.message || 
           'No status message available'}
        </div>
      </div>
      {showYAML && (
        <YAMLModal 
          resource={resource}
          onClose={() => setShowYAML(false)}
        />
      )}
    </>
  );
};

// Update the existing trace view to use the simplified ResourceRow component
const TraceView = ({ traceData }) => {
  if (!traceData) return null;

  return (
    <div className="bg-gray-100 rounded-lg overflow-hidden">
      <div className="px-4 py-2 bg-white border-b grid grid-cols-[300px,100px,100px,1fr] gap-4">
        <div className="font-medium text-gray-700">NAME</div>
        <div className="font-medium text-gray-700 text-center">SYNCED</div>
        <div className="font-medium text-gray-700 text-center">READY</div>
        <div className="font-medium text-gray-700">STATUS</div>
      </div>
      
      <div className="divide-y">
        {/* Claim */}
        <ResourceRow resource={traceData.claim} />
        
        {/* Composite */}
        <ResourceRow 
          resource={traceData.composite} 
          depth={1} 
          isLast={traceData.managedResources.length === 0}
        />
        
        {/* Managed Resources */}
        {traceData.managedResources.map((resource, index) => (
          <ResourceRow 
            key={`${resource.kind}-${resource.metadata.name}`}
            resource={resource}
            depth={1}
            isLast={index === traceData.managedResources.length - 1}
          />
        ))}
      </div>
    </div>
  );
};

const TraceModal = ({ isOpen, onClose, claim }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('trace');
  const [traceData, setTraceData] = useState(null);

  useEffect(() => {
    if (!isOpen || !claim) return;

    const fetchTrace = async () => {
      setLoading(true);
      setError(null);
      try {
        // Get the composite resource name from the claim
        const compositeRef = claim.spec?.resourceRef || claim.spec?.compositeRef;
        if (!compositeRef) {
          throw new Error('No composite resource reference found in claim');
        }

        // Fetch the composite resource (XR)
        const xrPlural = compositeRef.kind.toLowerCase() + 's';
        const xrPath = `/apis/${compositeRef.apiVersion}/${xrPlural}/${compositeRef.name}`;
        const xrData = await fetchResource(xrPath);

        // Get managed resources from the composite's status
        const extractManagedRefs = (xrData) => {
          const refs = [];
          
          // Primary location for managed resources
          if (xrData.spec?.resourceRefs) {
            refs.push(...xrData.spec.resourceRefs);
          }

          // Fallback locations - we check these in case the primary location is empty
          if (xrData.resourceRefs) {
            refs.push(...xrData.resourceRefs);
          }

          if (xrData.status?.resources) {
            refs.push(...xrData.status.resources);
          }
          
          if (xrData.status?.resourceRefs) {
            refs.push(...xrData.status.resourceRefs);
          }
          
          if (xrData.status?.resource?.refs) {
            refs.push(...xrData.status.resource.refs);
          }

          // Log the extracted refs for debugging
          console.log('Extracted managed refs:', refs);
          
          // Filter out invalid refs
          return refs.filter(ref => {
            if (!ref) return false;
            // Need at least name and kind to fetch the resource
            return (ref.name && ref.kind) || typeof ref === 'string';
          });
        };

        const managedRefs = extractManagedRefs(xrData);
        console.log('Found managed refs:', managedRefs);
        
        // Fetch each managed resource
        const fetchedResources = await Promise.all(managedRefs.map(async (ref) => {
          try {
            // Handle both object and string reference formats
            const resourceRef = typeof ref === 'string' ? ref : ref.name;
            const resourceKind = typeof ref === 'string' ? null : ref.kind;
            const resourceApiVersion = typeof ref === 'string' ? null : ref.apiVersion;

            if (!resourceRef) {
              console.warn('Invalid resource reference:', ref);
              return null;
            }

            // If we have the kind and apiVersion, use them to construct the path
            let path;
            if (resourceKind && resourceApiVersion) {
              const [group, version] = resourceApiVersion.split('/');
              const namespace = ref.namespace;
              const plural = resourceKind.toLowerCase() + 's';
              
              // Try cluster-scoped path first for AWS resources
              if (group.includes('aws')) {
                path = `/apis/${group}/${version}/${plural}/${resourceRef}`;
              } else {
                // For other resources, try namespaced path first
                path = namespace
                  ? `/apis/${group}/${version}/namespaces/${namespace}/${plural}/${resourceRef}`
                  : `/apis/${group}/${version}/${plural}/${resourceRef}`;
              }
            } else if (typeof ref === 'object') {
              // Handle resourceRefs format which might not have apiVersion
              const kind = ref.kind;
              const name = ref.name;
              const namespace = ref.namespace;
              const apiVersion = ref.apiVersion;

              if (kind && name) {
                if (apiVersion) {
                  const [group, version] = apiVersion.split('/');
                  const plural = kind.toLowerCase() + 's';
                  // Try cluster-scoped first for AWS resources
                  if (group.includes('aws')) {
                    path = `/apis/${group}/${version}/${plural}/${name}`;
                  } else {
                    path = namespace
                      ? `/apis/${group}/${version}/namespaces/${namespace}/${plural}/${name}`
                      : `/apis/${group}/${version}/${plural}/${name}`;
                  }
                } else {
                  // Try core API if no apiVersion specified
                  const plural = kind.toLowerCase() + 's';
                  path = namespace
                    ? `/api/v1/namespaces/${namespace}/${plural}/${name}`
                    : `/api/v1/${plural}/${name}`;
                }
              }
            }

            if (!path && typeof ref === 'string') {
              // Use the reference as a direct path
              path = ref;
            }

            if (!path) {
              console.warn('Could not construct path for resource:', ref);
              return null;
            }

            console.log('Attempting to fetch managed resource:', { path, ref });
            try {
              const resource = await fetchResource(path);
              if (!resource) {
                console.warn('No resource returned for path:', path);
                return null;
              }
              return resource;
            } catch (error) {
              // If the first attempt fails and it's a namespaced path, try cluster-scoped
              if (error.message?.includes('404') && path.includes('/namespaces/')) {
                const clusterPath = path.replace(/\/namespaces\/[^/]+/, '');
                console.log('Retrying as cluster-scoped resource:', clusterPath);
                try {
                  return await fetchResource(clusterPath);
                } catch (clusterError) {
                  console.error('Failed to fetch cluster-scoped resource:', clusterError);
                  return null;
                }
              }
              // If it's already cluster-scoped and failed, try namespaced as a last resort
              else if (error.message?.includes('404') && !path.includes('/namespaces/')) {
                const namespace = ref.namespace || 'default';
                const namespacedPath = path.replace(/\/([^/]+)\/([^/]+)$/, `/namespaces/${namespace}/$1/$2`);
                console.log('Retrying as namespaced resource:', namespacedPath);
                try {
                  return await fetchResource(namespacedPath);
                } catch (namespacedError) {
                  console.error('Failed to fetch namespaced resource:', namespacedError);
                  return null;
                }
              }
              console.error('Error fetching managed resource:', error);
              return null;
            }
          } catch (error) {
            console.error('Error processing managed resource:', error);
            return null;
          }
        }));

        const managedResources = fetchedResources.filter(Boolean);
        console.log('Fetched managed resources:', managedResources);

        setTraceData({
          claim: claim,
          composite: xrData,
          managedResources: managedResources
        });
      } catch (err) {
        console.error('Error fetching trace:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchTrace();
  }, [isOpen, claim]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-xl w-full max-w-[90vw] h-[90vh] flex flex-col overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white px-6 py-4 border-b border-gray-200 flex justify-between items-center shrink-0">
          <div>
            <h3 className="text-xl font-semibold text-gray-900">Resource Trace</h3>
            <p className="text-sm text-gray-500 mt-1">Showing the complete resource hierarchy</p>
          </div>
          <button 
            onClick={onClose}
            className="rounded-lg p-2 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 bg-white shrink-0">
          <div className="flex">
            <button
              onClick={() => setActiveTab('trace')}
              className={`px-4 py-2 text-sm font-medium ${
                activeTab === 'trace'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Trace View
            </button>
            <button
              onClick={() => setActiveTab('graph')}
              className={`px-4 py-2 text-sm font-medium ${
                activeTab === 'graph'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Graph View
            </button>
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-hidden p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              <span className="ml-3 text-gray-600">Loading trace data...</span>
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
              <div className="font-medium">Error loading trace data</div>
              <div className="text-sm mt-1">{error}</div>
            </div>
          ) : (
            activeTab === 'trace' ? (
              <div className="font-mono bg-gray-50 rounded-lg border border-gray-200 overflow-hidden flex flex-col h-full">
                {/* Header row with download button */}
                <div className="bg-gray-100 flex items-center px-4 py-2 sticky top-0 z-10">
                  <div className="grid grid-cols-[300px,100px,100px,1fr] items-center gap-4 text-sm font-medium text-gray-600 flex-1">
                    <div>NAME</div>
                    <div className="text-center">SYNCED</div>
                    <div className="text-center">READY</div>
                    <div>STATUS</div>
                  </div>
                  <button
                    onClick={() => {
                      const data = {
                        claim: traceData.claim,
                        composite: traceData.composite,
                        managedResources: traceData.managedResources
                      };
                      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${traceData.claim.kind}-${traceData.claim.metadata.name}-trace.json`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    }}
                    className="shrink-0 px-3 py-1 text-sm bg-blue-50 text-blue-600 rounded hover:bg-blue-100 flex items-center gap-1 ml-4"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download
                  </button>
                </div>

                {/* Scrollable data rows */}
                <div className="divide-y divide-gray-200 overflow-y-auto">
                  {/* Claim row */}
                  <ResourceRow resource={traceData.claim} />

                  {/* Composite row */}
                  <ResourceRow resource={traceData.composite} depth={1} isLast={traceData.managedResources.length === 0} />

                  {/* Managed resources rows */}
                  {traceData.managedResources.map((resource, index) => (
                    <ResourceRow 
                      key={`${resource.kind}-${resource.metadata.name}`}
                      resource={resource}
                      depth={1}
                      isLast={index === traceData.managedResources.length - 1}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-full bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
                <GraphView traceData={traceData} />
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
};

// Collapsible Namespace list
const NamespaceList = ({ namespaces, claimsByNamespace, onSelectClaim }) => {
  // Initialize with all namespaces expanded by default
  const [expandedNamespaces, setExpandedNamespaces] = useState(() => new Set(namespaces));
  const [isAllExpanded, setIsAllExpanded] = useState(true);

  const toggleNamespace = (namespace) => {
    setExpandedNamespaces(prev => {
      const newSet = new Set(prev);
      if (newSet.has(namespace)) {
        newSet.delete(namespace);
      } else {
        newSet.add(namespace);
      }
      return newSet;
    });
  };

  const toggleAllNamespaces = () => {
    if (isAllExpanded) {
      setExpandedNamespaces(new Set());
    } else {
      setExpandedNamespaces(new Set(namespaces));
    }
    setIsAllExpanded(!isAllExpanded);
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-semibold text-gray-900">Namespaces</h2>
        <button
          onClick={toggleAllNamespaces}
          className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
        >
          <svg 
            className={`w-4 h-4 transform transition-transform ${isAllExpanded ? 'rotate-90' : ''}`} 
            viewBox="0 0 20 20" 
            fill="currentColor"
          >
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
          <span>{isAllExpanded ? 'Collapse All' : 'Expand All'}</span>
        </button>
      </div>
      
      {namespaces.map(namespace => (
        <CollapsibleNamespace
          key={namespace}
          namespace={namespace}
          claims={claimsByNamespace[namespace]}
          isExpanded={expandedNamespaces.has(namespace)}
          onToggle={() => toggleNamespace(namespace)}
          onSelectClaim={onSelectClaim}
        />
      ))}
    </div>
  );
};

const NamespaceStatusIndicator = ({ claims }) => {
  // Calculate status counts
  const statusCounts = claims.reduce((acc, claim) => {
    const readyStatus = claim.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True';
    const syncedStatus = claim.status?.conditions?.find(c => c.type === 'Synced')?.status === 'True';
    
    if (readyStatus) acc.ready++;
    if (syncedStatus) acc.synced++;
    
    return acc;
  }, { ready: 0, synced: 0 });

  return (
    <div className="flex items-center space-x-3">
      <div className="relative group">
        <div className="flex items-center space-x-1">
          <div className={`w-2 h-2 rounded-full ${
            statusCounts.ready === claims.length ? 'bg-green-500' : 
            statusCounts.ready === 0 ? 'bg-red-500' : 'bg-yellow-500'
          }`} />
          <span className="text-xs text-gray-500">Ready</span>
        </div>
        <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block">
          <div className="bg-gray-900 text-white text-sm rounded-lg py-2 px-3 whitespace-nowrap">
            <div className="font-medium">Ready Status</div>
            <div className="text-xs text-gray-300 mt-1">
              {statusCounts.ready} of {claims.length} resources ready
            </div>
          </div>
        </div>
      </div>

      <div className="relative group">
        <div className="flex items-center space-x-1">
          <div className={`w-2 h-2 rounded-full ${
            statusCounts.synced === claims.length ? 'bg-green-500' : 
            statusCounts.synced === 0 ? 'bg-red-500' : 'bg-yellow-500'
          }`} />
          <span className="text-xs text-gray-500">Synced</span>
        </div>
        <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block">
          <div className="bg-gray-900 text-white text-sm rounded-lg py-2 px-3 whitespace-nowrap">
            <div className="font-medium">Sync Status</div>
            <div className="text-xs text-gray-300 mt-1">
              {statusCounts.synced} of {claims.length} resources synced
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Only show namespace status indicators when collapsed
const CollapsibleNamespace = ({ namespace, claims, isExpanded, onToggle, onSelectClaim }) => {
  return (
    <div className="mb-4">
      <div 
        className="flex items-center justify-between bg-white rounded-lg px-4 py-2 shadow-sm cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center space-x-2">
          <svg 
            className={`w-5 h-5 text-gray-500 transform transition-transform ${isExpanded ? 'rotate-90' : ''}`} 
            viewBox="0 0 20 20" 
            fill="currentColor"
          >
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
          <div>
            <h3 className="text-lg font-medium text-gray-900">
              {namespace}
            </h3>
            <div className="text-sm text-gray-500">
              {claims.length} {claims.length === 1 ? 'resource' : 'resources'}
            </div>
          </div>
        </div>
        
        {/* Only show namespace status when collapsed */}
        {!isExpanded && <NamespaceStatusIndicator claims={claims} />}
      </div>
      
      {isExpanded && (
        <div className="mt-2 space-y-2 pl-4">
          {claims.map((xr) => (
            <div
              key={xr.metadata.uid}
              onClick={() => onSelectClaim(xr)}
              className="bg-white rounded-lg p-4 shadow-sm border border-gray-200 hover:border-blue-500 hover:shadow-md transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-medium text-blue-600">{xr.metadata.name}</h4>
                <div className="flex items-center space-x-3">
                  <div className="relative group">
                    <div className="flex items-center space-x-1">
                      <div className={`w-2 h-2 rounded-full ${
                        xr.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True' 
                          ? 'bg-green-500' 
                          : 'bg-red-500'
                      }`} />
                      <span className="text-xs text-gray-500">Ready</span>
                    </div>
                    <div className="absolute bottom-full mb-2 hidden group-hover:block w-48 bg-gray-900 text-white text-sm rounded-lg py-1 px-2 right-0 transform translate-y-1">
                      <div className="font-medium">Ready: {xr.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True' ? 'True' : 'False'}</div>
                      <div className="text-xs text-gray-300 mt-1">{xr.status?.conditions?.find(c => c.type === 'Ready')?.message || 'No status message available'}</div>
                    </div>
                  </div>
                  <div className="relative group">
                    <div className="flex items-center space-x-1">
                      <div className={`w-2 h-2 rounded-full ${
                        xr.status?.conditions?.find(c => c.type === 'Synced')?.status === 'True' 
                          ? 'bg-green-500' 
                          : 'bg-red-500'
                      }`} />
                      <span className="text-xs text-gray-500">Synced</span>
                    </div>
                    <div className="absolute bottom-full mb-2 hidden group-hover:block w-48 bg-gray-900 text-white text-sm rounded-lg py-1 px-2 right-0 transform translate-y-1">
                      <div className="font-medium">Synced: {xr.status?.conditions?.find(c => c.type === 'Synced')?.status === 'True' ? 'True' : 'False'}</div>
                      <div className="text-xs text-gray-300 mt-1">{xr.status?.conditions?.find(c => c.type === 'Synced')?.message || 'No status message available'}</div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-2 text-sm text-gray-600">Kind: {xr.kind}</div>
              <div className="mt-1 text-xs text-gray-400">
                Created: {new Date(xr.metadata.creationTimestamp).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Main application component
export default function Home() {
  // State management
  const [xrs, setXrs] = useState([]);
  const [selectedClaim, setSelectedClaim] = useState(null);
  const [showYaml, setShowYaml] = useState(false);
  const [selectedNamespace, setSelectedNamespace] = useState('all');
  const [showTraceModal, setShowTraceModal] = useState(false);
  const [kubeContexts, setKubeContexts] = useState([]);
  const [currentContext, setCurrentContext] = useState('');
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPolling, setIsPolling] = useState(true);
  const [pollInterval, setPollInterval] = useState(30000); // 30 seconds default

  // Load resources for the current context
  const loadResources = useCallback(async () => {
    if (!currentContext) return;
    
    try {
      setIsLoading(true);
      const resources = await fetchCompositeResources();
      setXrs(resources);
      setError(null);
    } catch (err) {
      setError(err.message);
      // Clear stale data when there's an error
      setXrs([]);
      setSelectedClaim(null);
      console.error('Failed to load Crossplane resources:', err);
    } finally {
      setIsLoading(false);
    }
  }, [currentContext]);

  // Function to load kubeconfig and contexts
  const loadKubeConfig = useCallback(async () => {
    try {
      setIsLoading(true);
      const config = await getKubeConfig();
      setKubeContexts(config.contexts || []);
      setCurrentContext(config.currentContext);
      setError(null);
    } catch (err) {
      setError(err.message);
      // Clear stale data when there's an error
      setKubeContexts([]);
      setCurrentContext('');
      setXrs([]);
      setSelectedClaim(null);
      console.error('Failed to load Kubernetes configuration:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Function to refresh everything
  const refreshAll = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // Store current UI state
      const currentUIState = {
        showYaml,
        showTraceModal,
        selectedClaimId: selectedClaim?.metadata?.uid
      };

      // Refresh resources
      const resources = await fetchCompositeResources();
      setXrs(resources);

      // If there was a selected claim, find it in the new resources
      if (currentUIState.selectedClaimId) {
        const updatedClaim = resources.find(r => r.metadata.uid === currentUIState.selectedClaimId);
        if (updatedClaim) {
          // Restore the claim with preserved UI state
          setSelectedClaim({
            ...updatedClaim,
            _uiState: {
              showYaml: currentUIState.showYaml,
              showTraceModal: currentUIState.showTraceModal
            }
          });
          // Restore UI state
          setShowYaml(currentUIState.showYaml);
          setShowTraceModal(currentUIState.showTraceModal);
        }
      }
      
      setError(null);
    } catch (err) {
      setError(err.message);
      console.error('Failed to refresh:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [selectedClaim?.metadata?.uid, showYaml, showTraceModal]);

  // Set up polling effect for auto-refresh
  useEffect(() => {
    let pollTimer;
    
    const poll = async () => {
      try {
        // Store current UI state before refresh
        const currentUIState = {
          showYaml,
          showTraceModal,
          selectedClaimId: selectedClaim?.metadata?.uid
        };

        // Get fresh resources
        const resources = await fetchCompositeResources();
        setXrs(resources);

        // Try to restore the selected claim if it still exists
        if (currentUIState.selectedClaimId) {
          const updatedClaim = resources.find(r => r.metadata.uid === currentUIState.selectedClaimId);
          if (updatedClaim) {
            // Keep the UI state when refreshing
            setSelectedClaim({
              ...updatedClaim,
              _uiState: {
                showYaml: currentUIState.showYaml,
                showTraceModal: currentUIState.showTraceModal
              }
            });
            // Restore UI state
            setShowYaml(currentUIState.showYaml);
            setShowTraceModal(currentUIState.showTraceModal);
          }
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    };
    
    // Start/stop polling based on settings
    const startPolling = () => {
      if (isPolling && currentContext) {
        pollTimer = setInterval(poll, pollInterval);
      }
    };
    
    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
      }
    };
    
    startPolling();
    
    return () => {
      stopPolling();
    };
  }, [isPolling, pollInterval, currentContext, selectedClaim?.metadata?.uid, showYaml, showTraceModal]);

  useEffect(() => {
    loadKubeConfig();
  }, [loadKubeConfig]);

  useEffect(() => {
    loadResources();
  }, [loadResources]);

  // Handle context switching
  const handleContextChange = useCallback(async (contextName) => {
    try {
      setIsLoading(true);
      await setContext(contextName);
      setCurrentContext(contextName);
      
      // Load resources for the new context
      const resources = await fetchCompositeResources();
      setXrs(resources);
      
      // Try to find the selected claim in the new context
      if (selectedClaim) {
        const matchingClaim = resources.find(r => 
          r.kind === selectedClaim.kind && 
          r.metadata.name === selectedClaim.metadata.name &&
          r.claimNamespace === selectedClaim.claimNamespace
        );
        
        if (matchingClaim) {
          // Preserve UI state when switching contexts
          setSelectedClaim(prev => ({
            ...matchingClaim,
            _uiState: prev._uiState || {}
          }));
        } else {
          // Clear selection if claim not found in new context
          setSelectedClaim(null);
        }
      }
      
      setError(null);
    } catch (err) {
      setError(err.message);
      console.error('Failed to switch context:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedClaim]);

  // Get unique namespaces from claims
  const namespaces = [...new Set(xrs.map(xr => xr.claimNamespace).filter(Boolean))].sort();

  // Filter claims by selected namespace
  const filteredClaims = selectedNamespace === 'all' 
    ? xrs 
    : xrs.filter(xr => xr.claimNamespace === selectedNamespace);

  // Group claims by namespace
  const claimsByNamespace = filteredClaims.reduce((acc, claim) => {
    const namespace = claim.claimNamespace || 'default';
    if (!acc[namespace]) {
      acc[namespace] = [];
    }
    acc[namespace].push(claim);
    return acc;
  }, {});

  const handleSelectClaim = async (claim) => {
    setSelectedClaim(prev => ({
      ...claim,
      _uiState: {
        ...prev?._uiState,
        showYaml: prev?.metadata?.uid === claim.metadata.uid ? prev?._uiState?.showYaml : false,
        showTraceModal: prev?.metadata?.uid === claim.metadata.uid ? prev?._uiState?.showTraceModal : false
      }
    }));
    
    // Only reset UI state if selecting a different claim
    if (!selectedClaim || selectedClaim.metadata.uid !== claim.metadata.uid) {
      setShowYaml(false);
      setShowTraceModal(false);
    }
  };

  return (
    <div className="app-container" style={{ height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <TitleBar />
      <div className="content" style={{ height: 'calc(100vh - 28px)', marginTop: '28px', overflow: 'hidden' }}>
        <main className="h-full flex flex-col bg-gradient-to-br from-gray-50 to-gray-100">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white/50 backdrop-blur-sm shrink-0">
            <div className="flex items-center space-x-3">
              <svg className="w-8 h-8 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-blue-800">
                Crossplane Portal
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              {error && (
                <div className="text-red-600 text-sm bg-red-50 px-4 py-2 rounded-lg">
                  {error}
                </div>
              )}
              {(isLoading || isRefreshing) && (
                <div className="flex items-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                  <span className="text-sm text-gray-600">{isLoading ? 'Loading...' : 'Refreshing...'}</span>
                </div>
              )}
              <div className="flex items-center space-x-2">
                <button
                  onClick={refreshAll}
                  disabled={isLoading || isRefreshing}
                  className="flex items-center space-x-1 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50"
                  title="Refresh contexts and resources"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>Refresh</span>
                </button>
                <div className="flex items-center space-x-2">
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={isPolling}
                      onChange={(e) => setIsPolling(e.target.checked)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-600">Auto-refresh</span>
                  </label>
                  <select
                    value={pollInterval}
                    onChange={(e) => setPollInterval(Number(e.target.value))}
                    className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm text-gray-900 shadow-sm hover:border-blue-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
                    disabled={!isPolling}
                  >
                    <option value={10000}>10s</option>
                    <option value={30000}>30s</option>
                    <option value={60000}>1m</option>
                    <option value={300000}>5m</option>
                  </select>
                </div>
                <select
                  value={currentContext}
                  onChange={(e) => handleContextChange(e.target.value)}
                  className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-900 shadow-sm hover:border-blue-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
                  disabled={isLoading || isRefreshing}
                >
                  {kubeContexts.map((context) => (
                    <option key={context.name} value={context.name}>
                      {context.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Main content */}
          <div className="flex-1 overflow-hidden">
            <div className="h-full max-w-7xl mx-auto p-6">
              <div className="h-full grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Left Column - Claims */}
                <div className="h-full flex flex-col overflow-hidden">
                  <div className="flex items-center space-x-3 mb-6 shrink-0">
                    <svg className="w-6 h-6 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                    </svg>
                    <h2 className="text-2xl font-semibold text-gray-900">Claims</h2>
                  </div>
                  
                  <div className="shrink-0 mb-6">
                    {/* Namespace filter */}
                    <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Namespace</label>
                    <select
                      value={selectedNamespace}
                      onChange={(e) => setSelectedNamespace(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="all">All Namespaces</option>
                      {namespaces.map(ns => (
                        <option key={ns} value={ns}>{ns}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex-1 overflow-y-auto min-h-0 relative">
                    <div className="absolute inset-0 overflow-y-auto">
                      {/* Claims list */}
                      {Object.entries(claimsByNamespace).length > 0 ? (
                        <NamespaceList
                          namespaces={Object.keys(claimsByNamespace)}
                          claimsByNamespace={claimsByNamespace}
                          onSelectClaim={handleSelectClaim}
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full text-center p-6">
                          <svg className="w-16 h-16 text-gray-300 mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                          </svg>
                          <h3 className="text-lg font-medium text-gray-900 mb-2">No Claims Found</h3>
                          <p className="text-gray-500 max-w-sm">
                            There are no active claims in the current context. Claims will appear here when they are created.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Column - XR Details */}
                <div className="h-full flex flex-col">
                  <div className="flex items-center justify-between mb-6 shrink-0">
                    <div className="flex items-center space-x-3">
                      <svg className="w-6 h-6 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <h2 className="text-2xl font-semibold text-gray-900">XR Details</h2>
                    </div>
                    {selectedClaim && (
                      <button
                        onClick={() => setSelectedClaim(null)}
                        className="flex items-center space-x-1 px-3 py-2 text-sm font-medium text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Dismiss details"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        <span>Dismiss</span>
                      </button>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto">
                    {selectedClaim ? (
                      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="p-6">
                          <div className="flex justify-between items-center mb-6">
                            <button 
                              onClick={() => setShowYaml(!showYaml)}
                              className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                            >
                              {showYaml ? 'Hide Raw YAML' : 'Show Raw YAML'}
                            </button>
                            <button
                              onClick={() => setShowTraceModal(true)}
                              className="px-4 py-2 text-sm font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-100 transition-colors flex items-center space-x-2"
                            >
                              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                              </svg>
                              <span>View Resource Trace</span>
                            </button>
                          </div>

                          {showYaml ? (
                            <div className="bg-gray-50 rounded-lg border border-gray-200 max-h-[calc(100vh-300px)] overflow-auto">
                              <pre className="p-4 text-sm text-gray-800 font-mono whitespace-pre">
                                {toYAML(selectedClaim)}
                              </pre>
                            </div>
                          ) : (
                            <>
                              <div className="grid grid-cols-2 gap-4 mb-6">
                                <div>
                                  <div className="text-sm font-medium text-gray-500">Name</div>
                                  <div className="mt-1 text-gray-900">{selectedClaim.metadata.name}</div>
                                </div>
                                <div>
                                  <div className="text-sm font-medium text-gray-500">Namespace</div>
                                  <div className="mt-1 text-gray-900">{selectedClaim.claimNamespace || 'N/A'}</div>
                                </div>
                                <div>
                                  <div className="text-sm font-medium text-gray-500">Kind</div>
                                  <div className="mt-1 text-gray-900">{selectedClaim.kind}</div>
                                </div>
                                <div>
                                  <div className="text-sm font-medium text-gray-500">API Version</div>
                                  <div className="mt-1 text-gray-900">{selectedClaim.apiVersion}</div>
                                </div>
                                <div>
                                  <div className="text-sm font-medium text-gray-500">UID</div>
                                  <div className="mt-1 font-mono text-sm text-gray-900">{selectedClaim.metadata.uid}</div>
                                </div>
                                <div>
                                  <div className="text-sm font-medium text-gray-500">Created</div>
                                  <div className="mt-1 text-gray-900">
                                    {new Date(selectedClaim.metadata.creationTimestamp).toLocaleString()}
                                  </div>
                                </div>
                              </div>

                              <div className="border-t border-gray-200 pt-6">
                                <h3 className="text-lg font-medium text-gray-900 mb-4">Health Status</h3>
                                <div className="space-y-4">
                                  {selectedClaim.status?.conditions?.map((cond, i) => (
                                    <div key={i} className="bg-gray-50 rounded-lg p-4">
                                      <div className="flex items-center space-x-2">
                                        <div className={`w-2 h-2 rounded-full ${cond.status === 'True' ? 'bg-green-500' : 'bg-red-500'}`} />
                                        <div className="font-medium text-gray-900">{cond.type}</div>
                                      </div>
                                      <div className="mt-2 text-sm text-gray-600">{cond.message}</div>
                                      <div className="mt-1 text-xs text-gray-500">
                                        Last Updated: {new Date(cond.lastTransitionTime).toLocaleString()}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="bg-gray-50 rounded-lg p-6 text-center text-gray-500">
                        Select a resource from the left to see more details
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>

        <TraceModal
          isOpen={showTraceModal}
          onClose={() => setShowTraceModal(false)}
          claim={selectedClaim}
        />
      </div>
    </div>
  );
}

