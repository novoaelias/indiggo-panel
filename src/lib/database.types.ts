// GENERADO por `npm run db:types` (supabase gen types). No editar a mano.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      alerts: {
        Row: {
          created_at: string;
          detalle: string | null;
          entidad_id: string | null;
          entidad_tipo: string | null;
          id: string;
          resuelta_at: string | null;
          severidad: string;
          tipo: string;
          titulo: string;
        };
        Insert: {
          created_at?: string;
          detalle?: string | null;
          entidad_id?: string | null;
          entidad_tipo?: string | null;
          id?: string;
          resuelta_at?: string | null;
          severidad?: string;
          tipo: string;
          titulo: string;
        };
        Update: {
          created_at?: string;
          detalle?: string | null;
          entidad_id?: string | null;
          entidad_tipo?: string | null;
          id?: string;
          resuelta_at?: string | null;
          severidad?: string;
          tipo?: string;
          titulo?: string;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          created_at: string;
          id: string;
          nombre: string;
          origen: string;
          slug: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          nombre: string;
          origen?: string;
          slug: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          nombre?: string;
          origen?: string;
          slug?: string;
        };
        Relationships: [];
      };
      components: {
        Row: {
          created_at: string;
          group_member_id: string | null;
          id: string;
          minutos_produccion: number | null;
          nombre: string;
          notas: string | null;
          origen: string;
          stock_minimo: number;
          stock_real: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          group_member_id?: string | null;
          id?: string;
          minutos_produccion?: number | null;
          nombre: string;
          notas?: string | null;
          origen?: string;
          stock_minimo?: number;
          stock_real?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          group_member_id?: string | null;
          id?: string;
          minutos_produccion?: number | null;
          nombre?: string;
          notas?: string | null;
          origen?: string;
          stock_minimo?: number;
          stock_real?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "components_group_member_id_fkey";
            columns: ["group_member_id"];
            isOneToOne: false;
            referencedRelation: "group_members";
            referencedColumns: ["id"];
          },
        ];
      };
      content_pieces: {
        Row: {
          caption: string | null;
          created_at: string;
          estado: string;
          formato: string;
          hashtags: string | null;
          id: string;
          media_url: string | null;
          plataforma: string;
          product_id: string | null;
          updated_at: string;
        };
        Insert: {
          caption?: string | null;
          created_at?: string;
          estado?: string;
          formato?: string;
          hashtags?: string | null;
          id?: string;
          media_url?: string | null;
          plataforma: string;
          product_id?: string | null;
          updated_at?: string;
        };
        Update: {
          caption?: string | null;
          created_at?: string;
          estado?: string;
          formato?: string;
          hashtags?: string | null;
          id?: string;
          media_url?: string | null;
          plataforma?: string;
          product_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "content_pieces_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      group_members: {
        Row: {
          activo: boolean;
          created_at: string;
          group_id: string;
          id: string;
          nombre: string;
          orden: number;
        };
        Insert: {
          activo?: boolean;
          created_at?: string;
          group_id: string;
          id?: string;
          nombre: string;
          orden?: number;
        };
        Update: {
          activo?: boolean;
          created_at?: string;
          group_id?: string;
          id?: string;
          nombre?: string;
          orden?: number;
        };
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
        ];
      };
      groups: {
        Row: { created_at: string; id: string; nombre: string };
        Insert: { created_at?: string; id?: string; nombre: string };
        Update: { created_at?: string; id?: string; nombre?: string };
        Relationships: [];
      };
      integrations: {
        Row: {
          access_token: string | null;
          expires_at: string | null;
          meta: Json;
          provider: string;
          refresh_token: string | null;
          updated_at: string;
        };
        Insert: {
          access_token?: string | null;
          expires_at?: string | null;
          meta?: Json;
          provider: string;
          refresh_token?: string | null;
          updated_at?: string;
        };
        Update: {
          access_token?: string | null;
          expires_at?: string | null;
          meta?: Json;
          provider?: string;
          refresh_token?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      ml_listing_variations: {
        Row: {
          cantidad_ml: number | null;
          combinacion: Json | null;
          created_at: string;
          id: string;
          ml_listing_id: string;
          ml_variation_id: string;
          precio: number | null;
          product_variant_id: string | null;
          updated_at: string;
        };
        Insert: {
          cantidad_ml?: number | null;
          combinacion?: Json | null;
          created_at?: string;
          id?: string;
          ml_listing_id: string;
          ml_variation_id: string;
          precio?: number | null;
          product_variant_id?: string | null;
          updated_at?: string;
        };
        Update: {
          cantidad_ml?: number | null;
          combinacion?: Json | null;
          created_at?: string;
          id?: string;
          ml_listing_id?: string;
          ml_variation_id?: string;
          precio?: number | null;
          product_variant_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ml_listing_variations_ml_listing_id_fkey";
            columns: ["ml_listing_id"];
            isOneToOne: false;
            referencedRelation: "ml_listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ml_listing_variations_product_variant_id_fkey";
            columns: ["product_variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      ml_listings: {
        Row: {
          cantidad_ml: number | null;
          created_at: string;
          estado: string;
          id: string;
          ml_actualizado_at: string | null;
          ml_item_id: string;
          moneda: string;
          permalink: string | null;
          precio: number | null;
          product_id: string | null;
          raw: Json | null;
          sincronizado_at: string | null;
          thumbnail: string | null;
          tiene_variantes: boolean;
          titulo: string;
          updated_at: string;
        };
        Insert: {
          cantidad_ml?: number | null;
          created_at?: string;
          estado?: string;
          id?: string;
          ml_actualizado_at?: string | null;
          ml_item_id: string;
          moneda?: string;
          permalink?: string | null;
          precio?: number | null;
          product_id?: string | null;
          raw?: Json | null;
          sincronizado_at?: string | null;
          thumbnail?: string | null;
          tiene_variantes?: boolean;
          titulo: string;
          updated_at?: string;
        };
        Update: {
          cantidad_ml?: number | null;
          created_at?: string;
          estado?: string;
          id?: string;
          ml_actualizado_at?: string | null;
          ml_item_id?: string;
          moneda?: string;
          permalink?: string | null;
          precio?: number | null;
          product_id?: string | null;
          raw?: Json | null;
          sincronizado_at?: string | null;
          thumbnail?: string | null;
          tiene_variantes?: boolean;
          titulo?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ml_listings_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      ml_order_items: {
        Row: {
          cantidad: number;
          id: string;
          ml_item_id: string | null;
          ml_order_id: string;
          ml_variation_id: string | null;
          precio_unitario: number | null;
          product_variant_id: string | null;
          titulo: string | null;
        };
        Insert: {
          cantidad?: number;
          id?: string;
          ml_item_id?: string | null;
          ml_order_id: string;
          ml_variation_id?: string | null;
          precio_unitario?: number | null;
          product_variant_id?: string | null;
          titulo?: string | null;
        };
        Update: {
          cantidad?: number;
          id?: string;
          ml_item_id?: string | null;
          ml_order_id?: string;
          ml_variation_id?: string | null;
          precio_unitario?: number | null;
          product_variant_id?: string | null;
          titulo?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ml_order_items_ml_order_id_fkey";
            columns: ["ml_order_id"];
            isOneToOne: false;
            referencedRelation: "ml_orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ml_order_items_product_variant_id_fkey";
            columns: ["product_variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      ml_orders: {
        Row: {
          comprador: string | null;
          created_at: string;
          estado: string | null;
          estado_envio: string | null;
          fecha: string;
          id: string;
          ml_order_id: string;
          raw: Json | null;
          total: number | null;
        };
        Insert: {
          comprador?: string | null;
          created_at?: string;
          estado?: string | null;
          estado_envio?: string | null;
          fecha: string;
          id?: string;
          ml_order_id: string;
          raw?: Json | null;
          total?: number | null;
        };
        Update: {
          comprador?: string | null;
          created_at?: string;
          estado?: string | null;
          estado_envio?: string | null;
          fecha?: string;
          id?: string;
          ml_order_id?: string;
          raw?: Json | null;
          total?: number | null;
        };
        Relationships: [];
      };
      product_variants: {
        Row: {
          activo: boolean;
          created_at: string;
          etiqueta: string;
          group_member_id: string | null;
          id: string;
          product_id: string;
          sku: string | null;
          stock_minimo: number;
          stock_ml: number;
          stock_real: number;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          created_at?: string;
          etiqueta?: string;
          group_member_id?: string | null;
          id?: string;
          product_id: string;
          sku?: string | null;
          stock_minimo?: number;
          stock_ml?: number;
          stock_real?: number;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          created_at?: string;
          etiqueta?: string;
          group_member_id?: string | null;
          id?: string;
          product_id?: string;
          sku?: string | null;
          stock_minimo?: number;
          stock_ml?: number;
          stock_real?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_variants_group_member_id_fkey";
            columns: ["group_member_id"];
            isOneToOne: false;
            referencedRelation: "group_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_variants_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      production_tasks: {
        Row: {
          cantidad: number;
          component_id: string | null;
          created_at: string;
          estado: string;
          fuente: string;
          hecho_at: string | null;
          id: string;
          nombre: string;
          origen: string;
          para_fecha: string | null;
          product_variant_id: string | null;
          updated_at: string;
        };
        Insert: {
          cantidad?: number;
          component_id?: string | null;
          created_at?: string;
          estado?: string;
          fuente?: string;
          hecho_at?: string | null;
          id?: string;
          nombre: string;
          origen?: string;
          para_fecha?: string | null;
          product_variant_id?: string | null;
          updated_at?: string;
        };
        Update: {
          cantidad?: number;
          component_id?: string | null;
          created_at?: string;
          estado?: string;
          fuente?: string;
          hecho_at?: string | null;
          id?: string;
          nombre?: string;
          origen?: string;
          para_fecha?: string | null;
          product_variant_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "production_tasks_component_id_fkey";
            columns: ["component_id"];
            isOneToOne: false;
            referencedRelation: "components";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_tasks_product_variant_id_fkey";
            columns: ["product_variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          activo: boolean;
          category_id: string | null;
          created_at: string;
          group_id: string | null;
          id: string;
          nombre: string;
          notas: string | null;
          sku_base: string | null;
          updated_at: string;
          variantes_por_integrante: boolean;
        };
        Insert: {
          activo?: boolean;
          category_id?: string | null;
          created_at?: string;
          group_id?: string | null;
          id?: string;
          nombre: string;
          notas?: string | null;
          sku_base?: string | null;
          updated_at?: string;
          variantes_por_integrante?: boolean;
        };
        Update: {
          activo?: boolean;
          category_id?: string | null;
          created_at?: string;
          group_id?: string | null;
          id?: string;
          nombre?: string;
          notas?: string | null;
          sku_base?: string | null;
          updated_at?: string;
          variantes_por_integrante?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
        ];
      };
      variant_components: {
        Row: { cantidad: number; component_id: string; variant_id: string };
        Insert: { cantidad?: number; component_id: string; variant_id: string };
        Update: { cantidad?: number; component_id?: string; variant_id?: string };
        Relationships: [
          {
            foreignKeyName: "variant_components_component_id_fkey";
            columns: ["component_id"];
            isOneToOne: false;
            referencedRelation: "components";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "variant_components_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];
