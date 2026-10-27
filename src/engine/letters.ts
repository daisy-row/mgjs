// The small vocabulary everything else is written in: letters, tiles,
// squares and directions. A letter is an index into the alphabet, never a
// character — the alphabet turns one into the other at the edges.

export const SIZE = 15;

/** A letter, as its position in the alphabet. */
export type Letter = number;

/** A tile in the bag or on a rack: a letter, or the blank. */
export type Tile = number;
export const BLANK: Tile = -1;

/** A tile once it is on the board. A blank keeps that fact: it scores nothing. */
export interface PlacedTile {
  letter: Letter;
  isBlank: boolean;
}

export interface Position {
  x: number;
  y: number;
}

/** One tile put on one square during a turn. */
export interface Placement {
  position: Position;
  letter: Letter;
  isBlank: boolean;
}

export type Direction = 'horizontal' | 'vertical';
export const DIRECTIONS: readonly Direction[] = ['horizontal', 'vertical'];

export function at(x: number, y: number): Position {
  return { x, y };
}

export function isOnBoard(p: Position): boolean {
  return p.x >= 0 && p.x < SIZE && p.y >= 0 && p.y < SIZE;
}

/** Index into a row-major board array. */
export function boardIndex(p: Position): number {
  return p.y * SIZE + p.x;
}

export function positionOf(index: number): Position {
  return { x: index % SIZE, y: Math.floor(index / SIZE) };
}

export function stepping(p: Position, distance: number, direction: Direction): Position {
  return direction === 'horizontal' ? { x: p.x + distance, y: p.y } : { x: p.x, y: p.y + distance };
}

export function perpendicular(direction: Direction): Direction {
  return direction === 'horizontal' ? 'vertical' : 'horizontal';
}

/** The line a square sits on and its index along that line, so rows and
 *  columns can be treated the same way. */
export function lineOf(direction: Direction, p: Position): number {
  return direction === 'horizontal' ? p.y : p.x;
}

export function indexOf(direction: Direction, p: Position): number {
  return direction === 'horizontal' ? p.x : p.y;
}

export function positionOn(direction: Direction, line: number, index: number): Position {
  return direction === 'horizontal' ? { x: index, y: line } : { x: line, y: index };
}

export function samePosition(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Row-major order: top to bottom, then left to right. */
export function comparePositions(a: Position, b: Position): number {
  return a.y - b.y || a.x - b.x;
}

export function placementTile(p: Placement): Tile {
  return p.isBlank ? BLANK : p.letter;
}

export function placedTile(p: Placement): PlacedTile {
  return { letter: p.letter, isBlank: p.isBlank };
}

export function samePlacement(a: Placement, b: Placement): boolean {
  return samePosition(a.position, b.position) && a.letter === b.letter && a.isBlank === b.isBlank;
}

export function sortedPlacements(placements: readonly Placement[]): Placement[] {
  return [...placements].sort((a, b) => comparePositions(a.position, b.position));
}
