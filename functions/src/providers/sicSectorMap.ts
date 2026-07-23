import type { Sector } from "@proverbs/shared";

/**
 * Coarse SIC code (4-digit, used by SEC EDGAR filings) -> GICS-style sector
 * mapping. SIC and GICS classify along different axes, so this is a
 * best-effort approximation, not authoritative — good enough to bucket the
 * sector pages and sector filter without hand-curating each company. Ranges
 * follow the standard SIC division boundaries (https://www.osha.gov/data/sic-manual).
 *
 * IMPORTANT: checks are ordered narrowest-first — a broad range like
 * 2800-2899 (Chemicals -> Materials) would otherwise shadow a narrower
 * carve-out like 2834 (Pharmaceuticals -> Healthcare) nested inside it.
 */
export function sectorFromSicCode(sic: number | null): Sector | null {
  if (sic === null || Number.isNaN(sic)) return null;

  // --- Narrow carve-outs first ---
  if (sic >= 2830 && sic <= 2836) return "Healthcare"; // Pharmaceuticals, biological products
  if (sic >= 3570 && sic <= 3579) return "Technology"; // Computer & office equipment
  if (sic >= 3660 && sic <= 3699) return "Technology"; // Communications equipment, electronic components
  if (sic === 3711 || sic === 3721) return "Consumer Discretionary"; // Motor vehicles / aircraft (consumer-facing)
  if (sic >= 7370 && sic <= 7379) return "Technology"; // Computer services & prepackaged software
  if (sic >= 8000 && sic <= 8099) return "Healthcare"; // Health services

  // --- Broad SIC division ranges ---
  if (sic >= 100 && sic <= 999) return "Consumer Staples"; // Agriculture, forestry, fishing
  if (sic >= 1000 && sic <= 1099) return "Materials"; // Metal mining
  if (sic >= 1200 && sic <= 1299) return "Energy"; // Coal mining
  if (sic >= 1300 && sic <= 1399) return "Energy"; // Oil & gas extraction
  if (sic >= 1400 && sic <= 1499) return "Materials"; // Nonmetallic minerals
  if (sic >= 1500 && sic <= 1799) return "Industrials"; // Construction
  if (sic >= 2000 && sic <= 2199) return "Consumer Staples"; // Food, tobacco
  if (sic >= 2200 && sic <= 2399) return "Consumer Discretionary"; // Textiles, apparel
  if (sic >= 2400 && sic <= 2599) return "Materials"; // Lumber, furniture
  if (sic >= 2600 && sic <= 2699) return "Materials"; // Paper
  if (sic >= 2700 && sic <= 2799) return "Communication Services"; // Printing/publishing
  if (sic >= 2800 && sic <= 2899) return "Materials"; // Chemicals (pharma already carved out above)
  if (sic >= 2900 && sic <= 2999) return "Energy"; // Petroleum refining
  if (sic >= 3000 && sic <= 3099) return "Materials"; // Rubber, plastics
  if (sic >= 3200 && sic <= 3299) return "Materials"; // Stone, clay, glass
  if (sic >= 3300 && sic <= 3399) return "Materials"; // Primary metals
  if (sic >= 3400 && sic <= 3499) return "Industrials"; // Fabricated metals
  if (sic >= 3500 && sic <= 3599) return "Industrials"; // Industrial machinery (computers already carved out above)
  if (sic >= 3600 && sic <= 3699) return "Technology"; // Electronic equipment (communications already carved out above)
  if (sic >= 3700 && sic <= 3799) return "Industrials"; // Transportation equipment
  if (sic >= 3800 && sic <= 3849) return "Healthcare"; // Medical instruments
  if (sic >= 3850 && sic <= 3899) return "Technology"; // Precision instruments
  if (sic >= 3900 && sic <= 3999) return "Consumer Discretionary"; // Misc manufacturing
  if (sic >= 4000 && sic <= 4799) return "Industrials"; // Transportation
  if (sic >= 4800 && sic <= 4899) return "Communication Services"; // Communications
  if (sic >= 4900 && sic <= 4999) return "Utilities";
  if (sic >= 5000 && sic <= 5199) return "Industrials"; // Wholesale trade
  if (sic >= 5200 && sic <= 5399) return "Consumer Discretionary"; // Building materials, general merch
  if (sic >= 5400 && sic <= 5499) return "Consumer Staples"; // Food stores
  if (sic >= 5500 && sic <= 5799) return "Consumer Discretionary"; // Auto dealers, apparel, furniture, eating & drinking
  if (sic >= 5900 && sic <= 5999) return "Consumer Discretionary"; // Retail stores
  if (sic >= 6000 && sic <= 6199) return "Financials"; // Banking, credit
  if (sic >= 6200 && sic <= 6299) return "Financials"; // Security & commodity brokers
  if (sic >= 6300 && sic <= 6499) return "Financials"; // Insurance
  if (sic >= 6500 && sic <= 6599) return "Real Estate";
  if (sic >= 6700 && sic <= 6799) return "Financials"; // Holding & investment offices
  if (sic >= 7000 && sic <= 7099) return "Consumer Discretionary"; // Hotels
  if (sic >= 7200 && sic <= 7299) return "Consumer Discretionary"; // Personal services
  if (sic >= 7300 && sic <= 7399) return "Technology"; // Business services (software carved out above)
  if (sic >= 7400 && sic <= 7599) return "Consumer Discretionary"; // Auto/equipment rental & repair
  if (sic >= 7800 && sic <= 7999) return "Communication Services"; // Motion pictures, amusement, recreation
  if (sic >= 8100 && sic <= 8999) return "Healthcare"; // Legal/educational/social/health services fallback
  if (sic >= 9100 && sic <= 9999) return null; // Public administration — not applicable to public companies universe

  return null;
}
