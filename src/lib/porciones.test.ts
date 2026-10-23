import { describe, expect, it } from 'vitest';
import { equivalencia, fraccion, siguiente, textoCantidad } from './porciones';

describe('porciones', () => {
  it('muestra fracciones', () => {
    expect(fraccion(0.5)).toBe('½');
    expect(fraccion(0.75)).toBe('¾');
    expect(fraccion(1.25)).toBe('1¼');
    expect(fraccion(2)).toBe('2');
  });
  it('calcula la equivalencia en gramos', () => {
    expect(equivalencia('100 g', 0.75)).toBe('75 g');
    expect(equivalencia('250 ml', 2)).toBe('500 ml');
    expect(equivalencia('1 plato hondo (~550 g)', 1)).toBeNull();
    expect(textoCantidad(1.5, '100 g')).toBe('1½ × 100 g = 150 g');
    expect(textoCantidad(0.5, '1 plato (~400 g)')).toBe('½ × 1 plato (~400 g)');
  });
  it('avanza de a ¼ bajo 1 y de a ½ hasta 3', () => {
    expect(siguiente(0.5, 1)).toBe(0.75);
    expect(siguiente(1, -1)).toBe(0.75);
    expect(siguiente(1, 1)).toBe(1.5);
    expect(siguiente(0.25, -1)).toBe(0);
  });
});
