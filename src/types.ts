export interface Family {
  id: string
  name: string
  invite_code: string
  created_at: string
}

export interface FamilyMember {
  id: string
  family_id: string
  user_id: string
  role: string
  joined_at: string
  display_name?: string | null
  image_url?: string | null
}

export interface ShoppingItem {
  id: string
  family_id: string
  name: string
  brand: string | null
  image: string | null
  quantity: number
  completed: boolean
  created_by: string
  created_at: string
}

export interface ProductSuggestion {
  product_name: string
  brand: string
  image_url: string
}