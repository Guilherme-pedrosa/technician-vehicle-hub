import { describe, expect, it } from "vitest";
import { classifyKmDivergence, normalizeOdometerReading } from "./checklist-km";

describe("normalizeOdometerReading", () => {
  it('lê "27754 1 km" como 277541 (espaço não é decimal)', () => {
    const r = normalizeOdometerReading({ raw: "27754 1 km", legivel: true, expectedKm: 277000 });
    expect(r.normalized).toBe(277541);
    expect(r.digitCount).toBe(6);
    expect(r.decimalDetected).toBe(false);
    expect(r.autoUpdateAllowed).toBe(true);
  });

  it('lê "27754.1" como 27754 com decimal detectado', () => {
    const r = normalizeOdometerReading({ raw: "27754.1", legivel: true, expectedKm: 27700 });
    expect(r.normalized).toBe(27754);
    expect(r.decimalDetected).toBe(true);
    expect(r.decimalPart).toBe("1");
  });

  it('lê "27754,1 km" como 27754 com decimal detectado', () => {
    const r = normalizeOdometerReading({ raw: "27754,1 km", legivel: true });
    expect(r.normalized).toBe(27754);
    expect(r.decimalDetected).toBe(true);
  });

  it("Onix 277541 sem separador mantém os 6 dígitos", () => {
    const r = normalizeOdometerReading({ raw: "277541", km_lido: "277541", legivel: true, expectedKm: 276000 });
    expect(r.normalized).toBe(277541);
    expect(r.suspect).toBe(false);
    expect(r.autoUpdateAllowed).toBe(true);
  });

  it("marca suspeita quando faltam dígitos frente ao cadastro e bloqueia auto-update", () => {
    const r = normalizeOdometerReading({ raw: "27754", legivel: true, expectedKm: 277541 });
    expect(r.suspect).toBe(true);
    expect(r.autoUpdateAllowed).toBe(false);
  });

  it("leitura ambígua nunca autoriza auto-update", () => {
    const r = normalizeOdometerReading({ raw: "27754 1", ambiguous: true, legivel: true });
    expect(r.ambiguous).toBe(true);
    expect(r.autoUpdateAllowed).toBe(false);
  });

  it("sem dígitos legíveis devolve normalized null sem lançar", () => {
    const r = normalizeOdometerReading({ raw: "", legivel: false });
    expect(r.normalized).toBeNull();
    expect(r.autoUpdateAllowed).toBe(false);
  });
});

describe("classifyKmDivergence", () => {
  it("leitura segura MENOR que o cadastro sugere correção e não bloqueia", () => {
    const reading = normalizeOdometerReading({ raw: "120000", legivel: true, expectedKm: 125000 });
    const d = classifyKmDivergence(reading, 125000);
    expect(d.difference).toBe(-5000);
    expect(d.level).toBe("relevant");
    expect(d.suggestCorrection).toBe(true);
    expect(d.blocks).toBe(false);
  });

  it("divergência pequena é 'minor' e nunca bloqueia", () => {
    const reading = normalizeOdometerReading({ raw: "125100", legivel: true, expectedKm: 125000 });
    const d = classifyKmDivergence(reading, 125000);
    expect(d.level).toBe("minor");
    expect(d.blocks).toBe(false);
  });

  it("leitura insegura não sugere correção", () => {
    const reading = normalizeOdometerReading({ raw: "12510", ambiguous: true, expectedKm: 125000 });
    const d = classifyKmDivergence(reading, 125000);
    expect(d.suggestCorrection).toBe(false);
  });
});
