import { SCHEMA_ID, SCHEMA_VERSION } from './model';

/**
 * JSON Schema (draft 2020-12) for the machine-readable payload embedded in every
 * exported handoff file (`<script type="application/json" id="chrome-design-payload">`).
 * Bump SCHEMA_VERSION on any breaking change; additive optional fields are minor bumps.
 */

const num = { type: 'number' } as const;
const str = { type: 'string' } as const;
const isoDate = { type: 'string', format: 'date-time' } as const;

export const handoffSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: SCHEMA_ID,
  title: 'Chrome Design handoff payload',
  description:
    'Design feedback captured on a live web page: page metadata, annotation threads, decisions and drawings in page coordinates, plus pointers to the embedded snapshot and source blocks.',
  type: 'object',
  required: [
    '$schema',
    'schemaVersion',
    'kind',
    'generator',
    'exportedAt',
    'page',
    'agentPrompt',
    'summary',
    'annotations',
    'guides',
    'sanitize',
    'assets',
    'warnings',
    'blocks',
  ],
  properties: {
    $schema: { const: SCHEMA_ID },
    schemaVersion: { const: SCHEMA_VERSION },
    kind: { const: 'chrome-design.handoff' },
    generator: {
      type: 'object',
      required: ['name', 'version'],
      properties: { name: str, version: str },
    },
    exportedAt: isoDate,
    page: { $ref: '#/$defs/pageMeta' },
    brief: str,
    agentPrompt: { type: 'string', minLength: 1 },
    summary: {
      type: 'object',
      required: ['comments', 'openComments', 'changeRequests', 'decisions', 'questions', 'shapes'],
      properties: {
        comments: { type: 'integer', minimum: 0 },
        openComments: { type: 'integer', minimum: 0 },
        changeRequests: { type: 'integer', minimum: 0 },
        decisions: { type: 'integer', minimum: 0 },
        questions: { type: 'integer', minimum: 0 },
        shapes: { type: 'integer', minimum: 0 },
      },
    },
    annotations: { type: 'array', items: { $ref: '#/$defs/annotation' } },
    guides: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'axis', 'position'],
        properties: { id: str, axis: { enum: ['x', 'y'] }, position: num },
      },
    },
    grid: {
      type: 'object',
      required: ['visible', 'mode', 'count', 'columnWidth', 'margin', 'gutter', 'color', 'opacity'],
      properties: {
        visible: { type: 'boolean' },
        mode: { enum: ['stretch', 'fixed'] },
        count: { type: 'integer', minimum: 1 },
        columnWidth: num,
        margin: num,
        gutter: num,
        color: str,
        opacity: { type: 'number', minimum: 0, maximum: 100 },
      },
    },
    sanitize: {
      type: 'object',
      required: ['scripts', 'eventHandlers', 'javascriptUrls', 'frames', 'embeds', 'other'],
      additionalProperties: { type: 'integer', minimum: 0 },
    },
    assets: {
      type: 'object',
      required: ['embedded', 'embeddedBytes', 'failed'],
      properties: {
        embedded: { type: 'integer', minimum: 0 },
        embeddedBytes: { type: 'integer', minimum: 0 },
        failed: { type: 'integer', minimum: 0 },
      },
    },
    warnings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['code', 'message'],
        properties: { code: str, message: str, url: str },
      },
    },
    blocks: {
      type: 'object',
      required: ['snapshot', 'source', 'schema'],
      properties: {
        snapshot: {
          type: 'object',
          required: ['elementId', 'mediaType', 'escaping', 'bytes'],
          properties: {
            elementId: str,
            mediaType: { const: 'text/html' },
            escaping: str,
            bytes: { type: 'integer', minimum: 0 },
          },
        },
        source: {
          type: 'object',
          required: ['elementId', 'mediaType', 'bytes'],
          properties: {
            elementId: str,
            mediaType: { const: 'application/json' },
            bytes: { type: 'integer', minimum: 0 },
          },
        },
        schema: { type: 'object', required: ['elementId'], properties: { elementId: str } },
        screenshot: {
          type: 'object',
          required: ['elementId', 'width', 'height'],
          properties: { elementId: str, width: num, height: num },
        },
      },
    },
  },
  $defs: {
    point: { type: 'object', required: ['x', 'y'], properties: { x: num, y: num } },
    rect: {
      type: 'object',
      required: ['x', 'y', 'width', 'height'],
      properties: { x: num, y: num, width: { type: 'number', minimum: 0 }, height: { type: 'number', minimum: 0 } },
    },
    pageMeta: {
      type: 'object',
      required: ['url', 'title', 'capturedAt', 'viewport', 'scroll', 'document'],
      properties: {
        url: str,
        title: str,
        lang: str,
        charset: str,
        capturedAt: isoDate,
        timeZone: str,
        userAgent: str,
        colorScheme: { enum: ['light', 'dark'] },
        viewport: {
          type: 'object',
          required: ['width', 'height', 'devicePixelRatio'],
          properties: { width: num, height: num, devicePixelRatio: num },
        },
        scroll: { $ref: '#/$defs/point' },
        document: {
          type: 'object',
          required: ['width', 'height'],
          properties: { width: num, height: num },
        },
      },
    },
    anchor: {
      type: 'object',
      description: 'Pointer to a DOM element. `ref` matches a data-cd-ref attribute in the snapshot.',
      required: ['selector', 'path', 'tagName', 'classList', 'rect', 'styles'],
      properties: {
        selector: str,
        path: str,
        tagName: str,
        id: str,
        classList: { type: 'array', items: str },
        role: str,
        ariaLabel: str,
        text: str,
        rect: { $ref: '#/$defs/rect' },
        styles: { type: 'object', additionalProperties: str },
        ref: str,
      },
    },
    style: {
      type: 'object',
      required: ['color', 'width', 'dashed'],
      properties: { color: str, width: { type: 'number', minimum: 0 }, dashed: { type: 'boolean' } },
    },
    comment: {
      type: 'object',
      required: ['id', 'type', 'number', 'intent', 'status', 'target', 'messages', 'createdAt', 'updatedAt'],
      properties: {
        id: str,
        type: { const: 'comment' },
        number: { type: 'integer', minimum: 1 },
        intent: { enum: ['change', 'decision', 'question', 'note'] },
        status: { enum: ['open', 'resolved'] },
        target: {
          oneOf: [
            {
              type: 'object',
              required: ['type', 'point'],
              properties: { type: { const: 'point' }, point: { $ref: '#/$defs/point' }, anchor: { $ref: '#/$defs/anchor' } },
            },
            {
              type: 'object',
              required: ['type', 'point', 'anchor'],
              properties: { type: { const: 'element' }, point: { $ref: '#/$defs/point' }, anchor: { $ref: '#/$defs/anchor' } },
            },
            {
              type: 'object',
              required: ['type', 'rect', 'anchors'],
              properties: {
                type: { const: 'region' },
                rect: { $ref: '#/$defs/rect' },
                anchors: { type: 'array', items: { $ref: '#/$defs/anchor' } },
              },
            },
          ],
        },
        messages: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['id', 'body', 'createdAt'],
            properties: { id: str, body: str, createdAt: isoDate },
          },
        },
        createdAt: isoDate,
        updatedAt: isoDate,
      },
    },
    shape: {
      type: 'object',
      required: ['id', 'type', 'kind', 'style', 'createdAt'],
      properties: {
        id: str,
        type: { const: 'shape' },
        kind: { enum: ['pen', 'line', 'arrow', 'rect', 'ellipse', 'text'] },
        style: { $ref: '#/$defs/style' },
        createdAt: isoDate,
        points: { type: 'array', items: { $ref: '#/$defs/point' } },
        from: { $ref: '#/$defs/point' },
        to: { $ref: '#/$defs/point' },
        rect: { $ref: '#/$defs/rect' },
        point: { $ref: '#/$defs/point' },
        text: str,
        fontSize: num,
      },
      allOf: [
        { if: { properties: { kind: { const: 'pen' } } }, then: { required: ['points'] } },
        { if: { properties: { kind: { enum: ['line', 'arrow'] } } }, then: { required: ['from', 'to'] } },
        { if: { properties: { kind: { enum: ['rect', 'ellipse'] } } }, then: { required: ['rect'] } },
        { if: { properties: { kind: { const: 'text' } } }, then: { required: ['point', 'text', 'fontSize'] } },
      ],
    },
    annotation: {
      oneOf: [{ $ref: '#/$defs/comment' }, { $ref: '#/$defs/shape' }],
    },
  },
} as const;
