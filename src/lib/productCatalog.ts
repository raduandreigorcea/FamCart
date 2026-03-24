import { supabase } from './supabase'
import type { ProductSuggestion } from '../types'

const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_RESULTS = 8

interface CachedResult {
  data: ProductSuggestion[]
  expiresAt: number
}

interface ProductCatalogRow {
  id: number
  name: string
  brand: string | null
  image_url: string | null
  usage_count: number | null
  barcode?: string | null
  normalized_name: string
  normalized_brand: string | null
}

interface ItemSearchRow {
  id: string
  name: string
  brand: string | null
  image: string | null
  created_by: string
}

const searchCache = new Map<string, CachedResult>()
const inFlightRequests = new Map<string, Promise<ProductSuggestion[]>>()
let barcodeColumnAvailable = true

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function escapePostgrestLike(value: string) {
  return value.replace(/[,*()]/g, '')
}

function truncate(value: string, maxLen: number) {
  return value.length > maxLen ? value.slice(0, maxLen) : value
}

function sanitizeUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
  } catch {
    return ''
  }
  return trimmed
}

function sanitizeBarcode(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9-]/g, '')
}

function buildCacheKey(query: string, familyId?: string) {
  return familyId ? `${familyId}::${query}` : query
}

function stringToStableNumber(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0
  }

  return -Math.abs(hash || 1)
}

function isCacheFresh(cached: CachedResult | undefined, now = Date.now()) {
  return Boolean(cached && cached.expiresAt > now)
}

function toSuggestion(row: ProductCatalogRow): ProductSuggestion {
  return {
    id: row.id,
    product_name: row.name,
    brand: row.brand?.trim() ?? '',
    image_url: row.image_url?.trim() ?? '',
    usage_count: row.usage_count ?? 0,
    barcode: row.barcode?.trim() ?? '',
  }
}

function rankSuggestions(a: ProductSuggestion, b: ProductSuggestion) {
  const usageDiff = b.usage_count - a.usage_count
  if (usageDiff !== 0) return usageDiff

  const imageDiff = Number(Boolean(b.image_url)) - Number(Boolean(a.image_url))
  if (imageDiff !== 0) return imageDiff

  return a.product_name.localeCompare(b.product_name)
}

function dedupeSuggestions(suggestions: ProductSuggestion[]) {
  const seen = new Set<string>()
  const deduped: ProductSuggestion[] = []

  for (const suggestion of suggestions) {
    const key = `${normalizeText(suggestion.product_name)}::${normalizeText(suggestion.brand)}`
    if (seen.has(key)) continue

    seen.add(key)
    deduped.push(suggestion)

    if (deduped.length >= MAX_RESULTS) break
  }

  return deduped
}

function filterByQuery(suggestions: ProductSuggestion[], normalizedQuery: string) {
  return suggestions.filter((suggestion) => {
    const haystack = normalizeText(`${suggestion.product_name} ${suggestion.brand}`)
    return haystack.includes(normalizedQuery)
  })
}

function saveInMemoryCache(query: string, suggestions: ProductSuggestion[]) {
  searchCache.set(query, {
    data: suggestions,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })
}

function isMissingTableError(message: string) {
  return /relation .*product_catalog.* does not exist/i.test(message)
}

function isMissingBarcodeColumnError(message: string) {
  return /column .*barcode.* does not exist/i.test(message)
}

function getProductCatalogSelectColumns(includeBarcode = barcodeColumnAvailable) {
  const baseColumns = 'id,name,brand,image_url,usage_count,normalized_name,normalized_brand'
  return includeBarcode ? `${baseColumns},barcode` : baseColumns
}

export function clearProductCatalogCache() {
  searchCache.clear()
}

export function getCachedProductSuggestions(query: string, familyId?: string): ProductSuggestion[] {
  const normalizedQuery = normalizeText(query)
  if (normalizedQuery.length < 2) return []

  const now = Date.now()
  const cacheKey = buildCacheKey(normalizedQuery, familyId)
  const exact = searchCache.get(cacheKey)
  if (exact && isCacheFresh(exact, now)) {
    return exact.data
  }

  let bestPrefix = ''
  let bestData: ProductSuggestion[] = []

  for (const [cachedQuery, cachedResult] of searchCache.entries()) {
    if (!cachedQuery.startsWith(`${familyId ?? ''}::`) && familyId) continue
    if (!isCacheFresh(cachedResult, now)) continue
    const scopedQuery = familyId ? cachedQuery.slice(familyId.length + 2) : cachedQuery
    if (!normalizedQuery.startsWith(scopedQuery)) continue
    if (scopedQuery.length <= bestPrefix.length) continue

    bestPrefix = scopedQuery
    bestData = cachedResult.data
  }

  if (!bestData.length) return []
  return dedupeSuggestions(filterByQuery(bestData, normalizedQuery).sort(rankSuggestions))
}

async function searchFamilyItems(query: string, familyId: string, signal?: AbortSignal): Promise<ProductSuggestion[]> {
  const normalizedQuery = normalizeText(query)
  const rawPattern = `*${escapePostgrestLike(query.trim())}*`

  const response = await supabase
    .from('items')
    .select('id, name, brand, image, created_by')
    .eq('family_id', familyId)
    .or(`name.ilike.${rawPattern},brand.ilike.${rawPattern}`)
    .order('created_at', { ascending: false })
    .limit(30)

  if (response.error) {
    return []
  }

  if (signal?.aborted) {
    return []
  }

  const hydratedSuggestions = ((response.data as ItemSearchRow[] | null) ?? [])
    .map((row) => ({
      id: stringToStableNumber(`${row.name}::${row.brand ?? ''}`),
      product_name: row.name,
      brand: row.brand?.trim() ?? '',
      image_url: row.image?.trim() ?? '',
      usage_count: 0,
      barcode: '',
      created_by: row.created_by,
    }))
    .filter((suggestion) => normalizeText(`${suggestion.product_name} ${suggestion.brand}`).includes(normalizedQuery))
    .sort((a, b) => rankSuggestions(a, b))

  for (const suggestion of hydratedSuggestions) {
    void saveProductToCatalog({
      product_name: suggestion.product_name,
      brand: suggestion.brand,
      image_url: suggestion.image_url,
      created_by: suggestion.created_by,
    })
  }

  const suggestions = hydratedSuggestions.map(({ created_by: _createdBy, ...suggestion }) => suggestion)
  return dedupeSuggestions(suggestions)
}

export async function searchStoredProducts(query: string, familyId?: string, signal?: AbortSignal): Promise<ProductSuggestion[]> {
  const normalizedQuery = normalizeText(query)
  const rawQuery = query.trim()

  if (normalizedQuery.length < 2) {
    return []
  }

  const now = Date.now()
  const cacheKey = buildCacheKey(normalizedQuery, familyId)
  const cached = searchCache.get(cacheKey)
  if (cached && isCacheFresh(cached, now)) {
    return cached.data
  }

  const activePromise = inFlightRequests.get(cacheKey)
  if (activePromise) {
    return activePromise
  }

  const requestPromise = (async () => {
    const normalizedPattern = `*${escapePostgrestLike(normalizedQuery)}*`
    const rawPattern = `*${escapePostgrestLike(rawQuery)}*`

    let response = await supabase
      .from('product_catalog')
      .select(getProductCatalogSelectColumns())
      .or(
        `normalized_name.ilike.${normalizedPattern},normalized_brand.ilike.${normalizedPattern},name.ilike.${rawPattern},brand.ilike.${rawPattern}${barcodeColumnAvailable ? `,barcode.ilike.${rawPattern}` : ''}`,
      )
      .order('usage_count', { ascending: false })
      .order('name', { ascending: true })
      .limit(12)

    if (response.error && isMissingBarcodeColumnError(response.error.message)) {
      barcodeColumnAvailable = false
      response = await supabase
        .from('product_catalog')
        .select(getProductCatalogSelectColumns(false))
        .or(
          `normalized_name.ilike.${normalizedPattern},normalized_brand.ilike.${normalizedPattern},name.ilike.${rawPattern},brand.ilike.${rawPattern}`,
        )
        .order('usage_count', { ascending: false })
        .order('name', { ascending: true })
        .limit(12)
    }

    if (response.error) {
      if (isMissingTableError(response.error.message)) {
        return []
      }

      throw response.error
    }

    if (signal?.aborted) {
      return []
    }

    const rows = ((response.data as unknown as ProductCatalogRow[] | null) ?? [])
    const suggestions = rows
      .map(toSuggestion)
      .filter((suggestion) => normalizeText(`${suggestion.product_name} ${suggestion.brand}`).includes(normalizedQuery))
      .sort(rankSuggestions)

    const deduped = dedupeSuggestions(suggestions)
    if (deduped.length > 0) {
      saveInMemoryCache(cacheKey, deduped)
    }

    if (deduped.length === 0 && familyId) {
      const familySuggestions = await searchFamilyItems(query, familyId, signal)
      if (familySuggestions.length > 0) {
        saveInMemoryCache(cacheKey, familySuggestions)
        return familySuggestions
      }
    }

    return deduped
  })()

  inFlightRequests.set(cacheKey, requestPromise)

  try {
    return await requestPromise
  } finally {
    inFlightRequests.delete(cacheKey)
  }
}

export async function saveProductToCatalog(product: {
  product_name: string
  brand?: string
  image_url?: string
  barcode?: string
  created_by: string
}) {
  const normalizedName = normalizeText(truncate(product.product_name, 200))
  const normalizedBrand = normalizeText(truncate(product.brand ?? '', 100))
  const barcode = sanitizeBarcode(product.barcode ?? '')

  if (!normalizedName) return

  const existingResponse = barcode
    ? await supabase
      .from('product_catalog')
      .select(barcodeColumnAvailable ? 'id, usage_count, image_url, brand, barcode' : 'id, usage_count, image_url, brand')
      .eq('barcode', barcode)
      .maybeSingle()
    : await supabase
      .from('product_catalog')
      .select(barcodeColumnAvailable ? 'id, usage_count, image_url, brand, barcode' : 'id, usage_count, image_url, brand')
      .eq('normalized_name', normalizedName)
      .eq('normalized_brand', normalizedBrand)
      .maybeSingle()

  if (existingResponse.error) {
    if (isMissingBarcodeColumnError(existingResponse.error.message)) {
      barcodeColumnAvailable = false
      return await saveProductToCatalog({
        ...product,
        barcode: '',
      })
    }

    if (isMissingTableError(existingResponse.error.message)) return
    return
  }

  const nextImage = sanitizeUrl(product.image_url ?? '')
  const nextBrand = truncate((product.brand ?? '').trim(), 100)

  const existingData = existingResponse.data as unknown as {
    id: number
    usage_count: number | null
    image_url: string | null
    brand: string | null
    barcode?: string | null
  } | null

  if (existingData) {
    const currentUsage = typeof existingData.usage_count === 'number' ? existingData.usage_count : 0
    const updatePayload = {
      brand: nextBrand || existingData.brand || '',
      image_url: nextImage || existingData.image_url || '',
      usage_count: currentUsage + 1,
      last_used_at: new Date().toISOString(),
    } as Record<string, string | number>

    if (barcodeColumnAvailable) {
      updatePayload.barcode = barcode || (existingData.barcode ?? '')
    }

    const updateResponse = await supabase
      .from('product_catalog')
      .update(updatePayload)
      .eq('id', existingData.id)

    if (updateResponse.error && isMissingBarcodeColumnError(updateResponse.error.message)) {
      barcodeColumnAvailable = false
      await supabase
        .from('product_catalog')
        .update({
          brand: nextBrand || existingData.brand || '',
          image_url: nextImage || existingData.image_url || '',
          usage_count: currentUsage + 1,
          last_used_at: new Date().toISOString(),
        })
        .eq('id', existingData.id)
    }

    clearProductCatalogCache()
    return
  }

  const insertPayload = {
    name: truncate(product.product_name.trim(), 200),
    brand: nextBrand,
    image_url: nextImage,
    normalized_name: normalizedName,
    normalized_brand: normalizedBrand,
    usage_count: 1,
    created_by: product.created_by,
    last_used_at: new Date().toISOString(),
  } as Record<string, string | number>

  if (barcodeColumnAvailable) {
    insertPayload.barcode = barcode
  }

  let insertResponse = await supabase.from('product_catalog').insert(insertPayload)

  if (insertResponse.error && isMissingBarcodeColumnError(insertResponse.error.message)) {
    barcodeColumnAvailable = false
    delete insertPayload.barcode
    insertResponse = await supabase.from('product_catalog').insert(insertPayload)
  }

  if (insertResponse.error && isMissingTableError(insertResponse.error.message)) {
    return
  }

  clearProductCatalogCache()
}

export async function findStoredProductByBarcode(barcode: string): Promise<ProductSuggestion | null> {
  if (!barcodeColumnAvailable) return null

  const normalizedBarcode = barcode.trim()
  if (!normalizedBarcode) return null

  const response = await supabase
    .from('product_catalog')
    .select(getProductCatalogSelectColumns())
    .eq('barcode', normalizedBarcode)
    .maybeSingle()

  if (response.error) {
    if (isMissingBarcodeColumnError(response.error.message)) {
      barcodeColumnAvailable = false
      return null
    }

    if (isMissingTableError(response.error.message)) {
      return null
    }

    throw response.error
  }

  if (!response.data) return null
  return toSuggestion(response.data as unknown as ProductCatalogRow)
}