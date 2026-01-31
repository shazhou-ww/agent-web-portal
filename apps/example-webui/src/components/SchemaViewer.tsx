/**
 * Schema Viewer Component
 * 
 * Displays JSON Schema in either table or JSON format
 */

import { useState } from 'react';
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Typography,
  Chip,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from '@mui/material';
import {
  TableChart as TableIcon,
  Code as CodeIcon,
} from '@mui/icons-material';

interface SchemaProperty {
  type?: string;
  description?: string;
  default?: unknown;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  format?: string;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
  items?: SchemaProperty;
}

interface JsonSchema {
  type?: string;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
  [key: string]: unknown;
}

interface SchemaViewerProps {
  schema: JsonSchema;
  title?: string;
  defaultView?: 'table' | 'json';
}

/**
 * Format the type display with additional constraints
 */
function formatType(prop: SchemaProperty): string {
  let typeStr = prop.type || 'any';
  
  if (prop.enum) {
    return prop.enum.map(e => `"${e}"`).join(' | ');
  }
  
  if (prop.type === 'array' && prop.items) {
    typeStr = `${formatType(prop.items)}[]`;
  }
  
  if (prop.format) {
    typeStr = `${typeStr} (${prop.format})`;
  }
  
  return typeStr;
}

/**
 * Format constraints like min/max
 */
function formatConstraints(prop: SchemaProperty): string | null {
  const parts: string[] = [];
  
  if (prop.minimum !== undefined || prop.maximum !== undefined) {
    if (prop.minimum !== undefined && prop.maximum !== undefined) {
      parts.push(`${prop.minimum} - ${prop.maximum}`);
    } else if (prop.minimum !== undefined) {
      parts.push(`≥ ${prop.minimum}`);
    } else if (prop.maximum !== undefined) {
      parts.push(`≤ ${prop.maximum}`);
    }
  }
  
  if (prop.minLength !== undefined || prop.maxLength !== undefined) {
    if (prop.minLength !== undefined && prop.maxLength !== undefined) {
      parts.push(`len: ${prop.minLength}-${prop.maxLength}`);
    } else if (prop.minLength !== undefined) {
      parts.push(`len ≥ ${prop.minLength}`);
    } else if (prop.maxLength !== undefined) {
      parts.push(`len ≤ ${prop.maxLength}`);
    }
  }
  
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Format default value for display
 */
function formatDefault(value: unknown): string {
  if (value === undefined) return '-';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Render enum values as a list of chips
 */
function EnumList({ values }: { values: string[] }) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      {values.map((value) => (
        <Chip
          key={value}
          label={value}
          size="small"
          variant="outlined"
          sx={{ 
            height: 20, 
            fontSize: 11, 
            fontFamily: 'monospace',
            '& .MuiChip-label': { px: 1 }
          }}
        />
      ))}
    </Box>
  );
}

/**
 * Render the type cell content
 */
function TypeCell({ prop }: { prop: SchemaProperty }) {
  if (prop.enum && prop.enum.length > 0) {
    return <EnumList values={prop.enum} />;
  }
  
  return (
    <Typography 
      variant="body2" 
      sx={{ 
        fontFamily: 'monospace', 
        fontSize: 12,
      }}
    >
      {formatType(prop)}
    </Typography>
  );
}

/**
 * Render properties as table rows (supports nested objects)
 */
function renderPropertyRows(
  properties: Record<string, SchemaProperty>,
  required: string[] = [],
  prefix = ''
): JSX.Element[] {
  const rows: JSX.Element[] = [];
  
  for (const [name, prop] of Object.entries(properties)) {
    const fullName = prefix ? `${prefix}.${name}` : name;
    const isRequired = required.includes(name);
    const constraints = formatConstraints(prop);
    
    rows.push(
      <TableRow key={fullName} sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
        <TableCell sx={{ fontFamily: 'monospace', fontSize: 13 }}>
          {fullName}
          {isRequired && (
            <Chip 
              label="required" 
              size="small" 
              color="error" 
              variant="outlined"
              sx={{ ml: 1, height: 18, fontSize: 10 }} 
            />
          )}
        </TableCell>
        <TableCell>
          <TypeCell prop={prop} />
        </TableCell>
        <TableCell sx={{ fontSize: 12, color: 'text.secondary' }}>
          {prop.description || '-'}
        </TableCell>
        <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
          {formatDefault(prop.default)}
        </TableCell>
        <TableCell sx={{ fontSize: 11, color: 'text.secondary' }}>
          {constraints || '-'}
        </TableCell>
      </TableRow>
    );
    
    // Recursively render nested object properties
    if (prop.type === 'object' && prop.properties) {
      rows.push(...renderPropertyRows(prop.properties, prop.required || [], fullName));
    }
  }
  
  return rows;
}

/**
 * Table View of JSON Schema
 */
function TableView({ schema }: { schema: JsonSchema }) {
  if (!schema.properties || Object.keys(schema.properties).length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
        No properties defined
      </Typography>
    );
  }
  
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow sx={{ bgcolor: 'grey.100' }}>
            <TableCell sx={{ fontWeight: 600, width: '20%' }}>Property</TableCell>
            <TableCell sx={{ fontWeight: 600, width: '15%' }}>Type</TableCell>
            <TableCell sx={{ fontWeight: 600, width: '40%' }}>Description</TableCell>
            <TableCell sx={{ fontWeight: 600, width: '10%' }}>Default</TableCell>
            <TableCell sx={{ fontWeight: 600, width: '15%' }}>Constraints</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {renderPropertyRows(schema.properties, schema.required || [])}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/**
 * JSON View of schema
 */
function JsonView({ schema }: { schema: JsonSchema }) {
  return (
    <Box
      component="pre"
      sx={{
        p: 2,
        bgcolor: '#f5f5f5',
        borderRadius: 1,
        overflow: 'auto',
        fontSize: 12,
        m: 0,
      }}
    >
      {JSON.stringify(schema, null, 2)}
    </Box>
  );
}

/**
 * Schema Viewer with toggle between table and JSON views
 */
export function SchemaViewer({ schema, title, defaultView = 'table' }: SchemaViewerProps) {
  const [viewMode, setViewMode] = useState<'table' | 'json'>(defaultView);
  
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        {title && (
          <Typography variant="subtitle2">
            {title}
          </Typography>
        )}
        <ToggleButtonGroup
          value={viewMode}
          exclusive
          onChange={(_, newMode) => newMode && setViewMode(newMode)}
          size="small"
        >
          <ToggleButton value="table" sx={{ px: 1, py: 0.5 }}>
            <Tooltip title="Table View">
              <TableIcon fontSize="small" />
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="json" sx={{ px: 1, py: 0.5 }}>
            <Tooltip title="JSON View">
              <CodeIcon fontSize="small" />
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>
      
      {viewMode === 'table' ? (
        <TableView schema={schema} />
      ) : (
        <JsonView schema={schema} />
      )}
    </Box>
  );
}

export default SchemaViewer;
