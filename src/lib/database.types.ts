export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      alerts: {
        Row: {
          created_at: string
          detalle: string | null
          entidad_id: string | null
          entidad_tipo: string | null
          id: string
          resuelta_at: string | null
          severidad: string
          tipo: string
          titulo: string
        }
        Insert: {
          created_at?: string
          detalle?: string | null
          entidad_id?: string | null
          entidad_tipo?: string | null
          id?: string
          resuelta_at?: string | null
          severidad?: string
          tipo: string
          titulo: string
        }
        Update: {
          created_at?: string
          detalle?: string | null
          entidad_id?: string | null
          entidad_tipo?: string | null
          id?: string
          resuelta_at?: string | null
          severidad?: string
          tipo?: string
          titulo?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          id: string
          nombre: string
          origen: string
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          nombre: string
          origen?: string
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          nombre?: string
          origen?: string
          slug?: string
        }
        Relationships: []
      }
      components: {
        Row: {
          created_at: string
          group_member_id: string | null
          id: string
          minutos_placa: number | null
          minutos_produccion: number | null
          nombre: string
          notas: string | null
          origen: string
          rinde_por_placa: number | null
          stock_minimo: number
          stock_real: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          group_member_id?: string | null
          id?: string
          minutos_placa?: number | null
          minutos_produccion?: number | null
          nombre: string
          notas?: string | null
          origen?: string
          rinde_por_placa?: number | null
          stock_minimo?: number
          stock_real?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          group_member_id?: string | null
          id?: string
          minutos_placa?: number | null
          minutos_produccion?: number | null
          nombre?: string
          notas?: string | null
          origen?: string
          rinde_por_placa?: number | null
          stock_minimo?: number
          stock_real?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "components_group_member_id_fkey"
            columns: ["group_member_id"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["id"]
          },
        ]
      }
      content_pieces: {
        Row: {
          caption: string | null
          created_at: string
          error: string | null
          estado: string
          formato: string
          hashtags: string | null
          id: string
          kie_task_id: string | null
          media_url: string | null
          plataforma: string
          product_id: string | null
          updated_at: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          error?: string | null
          estado?: string
          formato?: string
          hashtags?: string | null
          id?: string
          kie_task_id?: string | null
          media_url?: string | null
          plataforma: string
          product_id?: string | null
          updated_at?: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          error?: string | null
          estado?: string
          formato?: string
          hashtags?: string | null
          id?: string
          kie_task_id?: string | null
          media_url?: string | null
          plataforma?: string
          product_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_pieces_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          activo: boolean
          created_at: string
          group_id: string
          id: string
          nombre: string
          orden: number
        }
        Insert: {
          activo?: boolean
          created_at?: string
          group_id: string
          id?: string
          nombre: string
          orden?: number
        }
        Update: {
          activo?: boolean
          created_at?: string
          group_id?: string
          id?: string
          nombre?: string
          orden?: number
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string
          id: string
          nombre: string
        }
        Insert: {
          created_at?: string
          id?: string
          nombre: string
        }
        Update: {
          created_at?: string
          id?: string
          nombre?: string
        }
        Relationships: []
      }
      integrations: {
        Row: {
          access_token: string | null
          expires_at: string | null
          meta: Json
          provider: string
          refresh_token: string | null
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          expires_at?: string | null
          meta?: Json
          provider: string
          refresh_token?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          expires_at?: string | null
          meta?: Json
          provider?: string
          refresh_token?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      listing_groups: {
        Row: {
          canonical_listing_id: string
          created_at: string
          id: string
          nombre: string | null
          updated_at: string
        }
        Insert: {
          canonical_listing_id: string
          created_at?: string
          id?: string
          nombre?: string | null
          updated_at?: string
        }
        Update: {
          canonical_listing_id?: string
          created_at?: string
          id?: string
          nombre?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_groups_canonical_listing_id_fkey"
            columns: ["canonical_listing_id"]
            isOneToOne: false
            referencedRelation: "ml_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      media_generations: {
        Row: {
          content_piece_id: string | null
          costo_usd: number
          created_at: string
          error: string | null
          id: string
          media_url: string | null
          modelo: string
          ok: boolean
          product_id: string | null
          prompt: string | null
          proveedor: string
          ref_urls: Json | null
          storage_path: string | null
          tipo: string
        }
        Insert: {
          content_piece_id?: string | null
          costo_usd?: number
          created_at?: string
          error?: string | null
          id?: string
          media_url?: string | null
          modelo: string
          ok?: boolean
          product_id?: string | null
          prompt?: string | null
          proveedor?: string
          ref_urls?: Json | null
          storage_path?: string | null
          tipo: string
        }
        Update: {
          content_piece_id?: string | null
          costo_usd?: number
          created_at?: string
          error?: string | null
          id?: string
          media_url?: string | null
          modelo?: string
          ok?: boolean
          product_id?: string | null
          prompt?: string | null
          proveedor?: string
          ref_urls?: Json | null
          storage_path?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_generations_content_piece_id_fkey"
            columns: ["content_piece_id"]
            isOneToOne: false
            referencedRelation: "content_pieces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_generations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_listing_variations: {
        Row: {
          cantidad_ml: number | null
          combinacion: Json | null
          created_at: string
          id: string
          ml_listing_id: string
          ml_variation_id: string
          precio: number | null
          product_variant_id: string | null
          updated_at: string
        }
        Insert: {
          cantidad_ml?: number | null
          combinacion?: Json | null
          created_at?: string
          id?: string
          ml_listing_id: string
          ml_variation_id: string
          precio?: number | null
          product_variant_id?: string | null
          updated_at?: string
        }
        Update: {
          cantidad_ml?: number | null
          combinacion?: Json | null
          created_at?: string
          id?: string
          ml_listing_id?: string
          ml_variation_id?: string
          precio?: number | null
          product_variant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_listing_variations_ml_listing_id_fkey"
            columns: ["ml_listing_id"]
            isOneToOne: false
            referencedRelation: "ml_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_listing_variations_product_variant_id_fkey"
            columns: ["product_variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_listings: {
        Row: {
          cantidad_ml: number | null
          categoria_analisis: Json | null
          categoria_sugerida: string | null
          created_at: string
          estado: string
          grupo_id: string | null
          id: string
          ml_actualizado_at: string | null
          ml_item_id: string
          moneda: string
          permalink: string | null
          precio: number | null
          product_id: string | null
          raw: Json | null
          reemplazada_por: string | null
          sincronizado_at: string | null
          thumbnail: string | null
          tiene_variantes: boolean
          titulo: string
          updated_at: string
        }
        Insert: {
          cantidad_ml?: number | null
          categoria_analisis?: Json | null
          categoria_sugerida?: string | null
          created_at?: string
          estado?: string
          grupo_id?: string | null
          id?: string
          ml_actualizado_at?: string | null
          ml_item_id: string
          moneda?: string
          permalink?: string | null
          precio?: number | null
          product_id?: string | null
          raw?: Json | null
          reemplazada_por?: string | null
          sincronizado_at?: string | null
          thumbnail?: string | null
          tiene_variantes?: boolean
          titulo: string
          updated_at?: string
        }
        Update: {
          cantidad_ml?: number | null
          categoria_analisis?: Json | null
          categoria_sugerida?: string | null
          created_at?: string
          estado?: string
          grupo_id?: string | null
          id?: string
          ml_actualizado_at?: string | null
          ml_item_id?: string
          moneda?: string
          permalink?: string | null
          precio?: number | null
          product_id?: string | null
          raw?: Json | null
          reemplazada_por?: string | null
          sincronizado_at?: string | null
          thumbnail?: string | null
          tiene_variantes?: boolean
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_listings_grupo_id_fkey"
            columns: ["grupo_id"]
            isOneToOne: false
            referencedRelation: "listing_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_listings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_order_items: {
        Row: {
          cantidad: number
          id: string
          ml_item_id: string | null
          ml_order_id: string
          ml_variation_id: string | null
          precio_unitario: number | null
          product_variant_id: string | null
          titulo: string | null
        }
        Insert: {
          cantidad?: number
          id?: string
          ml_item_id?: string | null
          ml_order_id: string
          ml_variation_id?: string | null
          precio_unitario?: number | null
          product_variant_id?: string | null
          titulo?: string | null
        }
        Update: {
          cantidad?: number
          id?: string
          ml_item_id?: string | null
          ml_order_id?: string
          ml_variation_id?: string | null
          precio_unitario?: number | null
          product_variant_id?: string | null
          titulo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_order_items_ml_order_id_fkey"
            columns: ["ml_order_id"]
            isOneToOne: false
            referencedRelation: "ml_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_order_items_product_variant_id_fkey"
            columns: ["product_variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_orders: {
        Row: {
          comprador: string | null
          created_at: string
          envio_substatus: string | null
          envio_sync_at: string | null
          estado: string | null
          estado_envio: string | null
          fecha: string
          id: string
          logistic_type: string | null
          ml_order_id: string
          raw: Json | null
          sheet_synced_at: string | null
          stock_descontado_at: string | null
          total: number | null
        }
        Insert: {
          comprador?: string | null
          created_at?: string
          envio_substatus?: string | null
          envio_sync_at?: string | null
          estado?: string | null
          estado_envio?: string | null
          fecha: string
          id?: string
          logistic_type?: string | null
          ml_order_id: string
          raw?: Json | null
          sheet_synced_at?: string | null
          stock_descontado_at?: string | null
          total?: number | null
        }
        Update: {
          comprador?: string | null
          created_at?: string
          envio_substatus?: string | null
          envio_sync_at?: string | null
          estado?: string | null
          estado_envio?: string | null
          fecha?: string
          id?: string
          logistic_type?: string | null
          ml_order_id?: string
          raw?: Json | null
          sheet_synced_at?: string | null
          stock_descontado_at?: string | null
          total?: number | null
        }
        Relationships: []
      }
      product_variants: {
        Row: {
          activo: boolean
          created_at: string
          es_eleccion: boolean
          etiqueta: string
          group_member_id: string | null
          id: string
          product_id: string
          sku: string | null
          stock_minimo: number
          stock_ml: number
          stock_real: number
          updated_at: string
        }
        Insert: {
          activo?: boolean
          created_at?: string
          es_eleccion?: boolean
          etiqueta?: string
          group_member_id?: string | null
          id?: string
          product_id: string
          sku?: string | null
          stock_minimo?: number
          stock_ml?: number
          stock_real?: number
          updated_at?: string
        }
        Update: {
          activo?: boolean
          created_at?: string
          es_eleccion?: boolean
          etiqueta?: string
          group_member_id?: string | null
          id?: string
          product_id?: string
          sku?: string | null
          stock_minimo?: number
          stock_ml?: number
          stock_real?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_group_member_id_fkey"
            columns: ["group_member_id"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      production_tasks: {
        Row: {
          cantidad: number
          component_id: string | null
          created_at: string
          estado: string
          fuente: string
          hecho_at: string | null
          id: string
          nombre: string
          origen: string
          para_fecha: string | null
          product_variant_id: string | null
          updated_at: string
        }
        Insert: {
          cantidad?: number
          component_id?: string | null
          created_at?: string
          estado?: string
          fuente?: string
          hecho_at?: string | null
          id?: string
          nombre: string
          origen?: string
          para_fecha?: string | null
          product_variant_id?: string | null
          updated_at?: string
        }
        Update: {
          cantidad?: number
          component_id?: string | null
          created_at?: string
          estado?: string
          fuente?: string
          hecho_at?: string | null
          id?: string
          nombre?: string
          origen?: string
          para_fecha?: string | null
          product_variant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_tasks_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_tasks_product_variant_id_fkey"
            columns: ["product_variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          activo: boolean
          category_id: string | null
          created_at: string
          descontinuado: boolean
          group_id: string | null
          id: string
          nombre: string
          notas: string | null
          sku_base: string | null
          updated_at: string
          variantes_por_integrante: boolean
        }
        Insert: {
          activo?: boolean
          category_id?: string | null
          created_at?: string
          descontinuado?: boolean
          group_id?: string | null
          id?: string
          nombre: string
          notas?: string | null
          sku_base?: string | null
          updated_at?: string
          variantes_por_integrante?: boolean
        }
        Update: {
          activo?: boolean
          category_id?: string | null
          created_at?: string
          descontinuado?: boolean
          group_id?: string | null
          id?: string
          nombre?: string
          notas?: string | null
          sku_base?: string | null
          updated_at?: string
          variantes_por_integrante?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      variant_components: {
        Row: {
          cantidad: number
          component_id: string
          variant_id: string
        }
        Insert: {
          cantidad?: number
          component_id: string
          variant_id: string
        }
        Update: {
          cantidad?: number
          component_id?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "variant_components_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_components_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      panel_metricas: { Args: { p_dias?: number }; Returns: Json }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
