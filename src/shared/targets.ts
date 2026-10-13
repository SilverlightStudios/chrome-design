import { shapeBounds } from './geometry';
import type { Annotation, CommentTarget, Point, Shape } from './model';
import { isShape } from './model';

/**
 * Comments can belong to something the designer placed (an image or a drawing) rather than the
 * page. Their pin is kept as a spot within that thing's box (fractions of its width and
 * height), so it travels and scales with it.
 */

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** Where in a shape's box a page point falls, as fractions (clamped to the box). */
export function spotIn(shape: Shape, p: Point): Point {
  const b = shapeBounds(shape);
  return {
    x: b.width > 0 ? clamp((p.x - b.x) / b.width) : 0,
    y: b.height > 0 ? clamp((p.y - b.y) / b.height) : 0,
  };
}

/** The page point at a spot within a shape's box. */
export function pointIn(shape: Shape, at: Point): Point {
  const b = shapeBounds(shape);
  return { x: b.x + b.width * at.x, y: b.y + b.height * at.y };
}

export function findShape(shapes: readonly Annotation[], id: string): Shape | undefined {
  const found = shapes.find((a) => a.id === id);
  return found && isShape(found) ? found : undefined;
}

/**
 * Where a comment's pin sits from the stored data alone (no live page): the export and the
 * no-JavaScript view use this; the live UI also follows moved page elements.
 */
export function storedTargetPoint(
  target: CommentTarget,
  annotations: readonly Annotation[],
): Point {
  if (target.type === 'region') return { x: target.rect.x, y: target.rect.y };
  if (target.type === 'shape') {
    const shape = findShape(annotations, target.shapeId);
    return shape ? pointIn(shape, target.at) : target.point;
  }
  return target.point;
}

/** A short name for a placed thing, for the comment bubble and the lists. */
export function shapeLabel(shape: Shape): string {
  switch (shape.kind) {
    case 'image':
      return 'Image';
    case 'redact':
      return 'Hidden area';
    case 'text':
      return 'Text label';
    case 'pen':
      return 'Drawing';
    case 'rect':
      return 'Rectangle';
    case 'ellipse':
      return 'Ellipse';
    case 'arrow':
      return 'Arrow';
    case 'line':
      return 'Line';
  }
}
