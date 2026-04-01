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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      checklist_config: {
        Row: {
          config_key: string
          id: string
          inspection_fields: Json
          photo_categories: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          config_key?: string
          id?: string
          inspection_fields?: Json
          photo_categories?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          config_key?: string
          id?: string
          inspection_fields?: Json
          photo_categories?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      daily_vehicle_km: {
        Row: {
          adesao_id: string
          data: string
          hr_vinculo: string | null
          id: string
          km_percorrido: number
          motorista_id: string | null
          motorista_nome: string
          placa: string
          synced_at: string
          tempo_deslocamento: string | null
          tipo_vinculo: string | null
        }
        Insert: {
          adesao_id: string
          data: string
          hr_vinculo?: string | null
          id?: string
          km_percorrido?: number
          motorista_id?: string | null
          motorista_nome?: string
          placa: string
          synced_at?: string
          tempo_deslocamento?: string | null
          tipo_vinculo?: string | null
        }
        Update: {
          adesao_id?: string
          data?: string
          hr_vinculo?: string | null
          id?: string
          km_percorrido?: number
          motorista_id?: string | null
          motorista_nome?: string
          placa?: string
          synced_at?: string
          tempo_deslocamento?: string | null
          tipo_vinculo?: string | null
        }
        Relationships: []
      }
      driver_performance_records: {
        Row: {
          checklists_completos: number
          checklists_esperados: number
          comprovantes_perdidos: number
          created_at: string
          created_by: string
          danos_veiculo: number
          defeitos_sem_lancamento: number
          driver_id: string
          ferramentas_danificadas: number
          id: string
          km_sem_telemetria: number
          observacoes: string | null
          period_end: string
          period_start: string
        }
        Insert: {
          checklists_completos?: number
          checklists_esperados?: number
          comprovantes_perdidos?: number
          created_at?: string
          created_by: string
          danos_veiculo?: number
          defeitos_sem_lancamento?: number
          driver_id: string
          ferramentas_danificadas?: number
          id?: string
          km_sem_telemetria?: number
          observacoes?: string | null
          period_end: string
          period_start: string
        }
        Update: {
          checklists_completos?: number
          checklists_esperados?: number
          comprovantes_perdidos?: number
          created_at?: string
          created_by?: string
          danos_veiculo?: number
          defeitos_sem_lancamento?: number
          driver_id?: string
          ferramentas_danificadas?: number
          id?: string
          km_sem_telemetria?: number
          observacoes?: string | null
          period_end?: string
          period_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_performance_records_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_vehicle_assignments: {
        Row: {
          assigned_at: string
          created_by: string
          driver_id: string
          id: string
          km_fim: number | null
          km_inicio: number
          returned_at: string | null
          vehicle_id: string
        }
        Insert: {
          assigned_at?: string
          created_by: string
          driver_id: string
          id?: string
          km_fim?: number | null
          km_inicio?: number
          returned_at?: string | null
          vehicle_id: string
        }
        Update: {
          assigned_at?: string
          created_by?: string
          driver_id?: string
          id?: string
          km_fim?: number | null
          km_inicio?: number
          returned_at?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_vehicle_assignments_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_vehicle_assignments_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          categoria_cnh: string
          cnh: string
          cnh_validade: string
          created_at: string
          full_name: string
          id: string
          phone: string | null
          status: Database["public"]["Enums"]["driver_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          categoria_cnh?: string
          cnh: string
          cnh_validade: string
          created_at?: string
          full_name: string
          id?: string
          phone?: string | null
          status?: Database["public"]["Enums"]["driver_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          categoria_cnh?: string
          cnh?: string
          cnh_validade?: string
          created_at?: string
          full_name?: string
          id?: string
          phone?: string | null
          status?: Database["public"]["Enums"]["driver_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          checklist_id: string | null
          created_at: string
          error_message: string | null
          id: string
          metadata: Json | null
          recipient_email: string
          resend_id: string | null
          status: string
          subject: string | null
        }
        Insert: {
          checklist_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          metadata?: Json | null
          recipient_email: string
          resend_id?: string | null
          status?: string
          subject?: string | null
        }
        Update: {
          checklist_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          metadata?: Json | null
          recipient_email?: string
          resend_id?: string | null
          status?: string
          subject?: string | null
        }
        Relationships: []
      }
      maintenance_executions: {
        Row: {
          cost: number | null
          created_at: string | null
          executed_at: string | null
          executed_by: string | null
          id: string
          km_at_execution: number
          maintenance_plan_id: string
          next_date_due: string | null
          next_km_due: number | null
          notes: string | null
          ticket_id: string | null
          vehicle_id: string
        }
        Insert: {
          cost?: number | null
          created_at?: string | null
          executed_at?: string | null
          executed_by?: string | null
          id?: string
          km_at_execution: number
          maintenance_plan_id: string
          next_date_due?: string | null
          next_km_due?: number | null
          notes?: string | null
          ticket_id?: string | null
          vehicle_id: string
        }
        Update: {
          cost?: number | null
          created_at?: string | null
          executed_at?: string | null
          executed_by?: string | null
          id?: string
          km_at_execution?: number
          maintenance_plan_id?: string
          next_date_due?: string | null
          next_km_due?: number | null
          notes?: string | null
          ticket_id?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_executions_maintenance_plan_id_fkey"
            columns: ["maintenance_plan_id"]
            isOneToOne: false
            referencedRelation: "maintenance_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_executions_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "maintenance_tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_executions_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_plans: {
        Row: {
          active: boolean | null
          alert_threshold_pct: number | null
          applies_to_all: boolean | null
          category: string
          created_at: string | null
          description: string | null
          executor_type: string
          id: string
          item_type: string
          km_interval: number | null
          name: string
          time_interval_days: number
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          alert_threshold_pct?: number | null
          applies_to_all?: boolean | null
          category: string
          created_at?: string | null
          description?: string | null
          executor_type?: string
          id?: string
          item_type: string
          km_interval?: number | null
          name: string
          time_interval_days: number
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          alert_threshold_pct?: number | null
          applies_to_all?: boolean | null
          category?: string
          created_at?: string | null
          description?: string | null
          executor_type?: string
          id?: string
          item_type?: string
          km_interval?: number | null
          name?: string
          time_interval_days?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      maintenance_tickets: {
        Row: {
          assigned_to: string | null
          created_at: string
          created_by: string
          descricao: string | null
          driver_id: string | null
          fotos: string[] | null
          id: string
          maintenance_plan_id: string | null
          prioridade: Database["public"]["Enums"]["ticket_priority"]
          status: Database["public"]["Enums"]["ticket_status"]
          tipo: Database["public"]["Enums"]["ticket_type"]
          titulo: string
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          created_by: string
          descricao?: string | null
          driver_id?: string | null
          fotos?: string[] | null
          id?: string
          maintenance_plan_id?: string | null
          prioridade?: Database["public"]["Enums"]["ticket_priority"]
          status?: Database["public"]["Enums"]["ticket_status"]
          tipo?: Database["public"]["Enums"]["ticket_type"]
          titulo: string
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string
          descricao?: string | null
          driver_id?: string | null
          fotos?: string[] | null
          id?: string
          maintenance_plan_id?: string | null
          prioridade?: Database["public"]["Enums"]["ticket_priority"]
          status?: Database["public"]["Enums"]["ticket_status"]
          tipo?: Database["public"]["Enums"]["ticket_type"]
          titulo?: string
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_tickets_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_tickets_maintenance_plan_id_fkey"
            columns: ["maintenance_plan_id"]
            isOneToOne: false
            referencedRelation: "maintenance_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_tickets_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          cargo: string | null
          created_at: string
          full_name: string
          id: string
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          cargo?: string | null
          created_at?: string
          full_name?: string
          id?: string
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          cargo?: string | null
          created_at?: string
          full_name?: string
          id?: string
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ticket_actions: {
        Row: {
          completed_at: string | null
          concluida: boolean
          created_at: string
          created_by: string
          descricao: string
          id: string
          sort_order: number
          ticket_id: string
        }
        Insert: {
          completed_at?: string | null
          concluida?: boolean
          created_at?: string
          created_by: string
          descricao: string
          id?: string
          sort_order?: number
          ticket_id: string
        }
        Update: {
          completed_at?: string | null
          concluida?: boolean
          created_at?: string
          created_by?: string
          descricao?: string
          id?: string
          sort_order?: number
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_actions_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "maintenance_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vehicle_checklists: {
        Row: {
          acessorios: string
          avaria_descricao: string | null
          avaria_nova: string
          calibragem_ok: string
          cambio: string
          checklist_date: string
          conducao_ok: string
          created_at: string
          created_by: string
          danos_veiculo: string
          destino: string | null
          detalhes: Json | null
          driver_id: string | null
          farois_lanternas: string
          fluidos_ok: string
          fotos: Json | null
          id: string
          itens_seguranca: string
          kit_ok: string
          limpeza_organizacao: string
          motor: string
          nivel_agua: string
          nivel_oleo: string
          observacoes: string | null
          pneu_estepe: string
          pneus: string
          pneus_visual_ok: string
          resultado: string
          resultado_motivo: string | null
          ruido_anormal: string
          som: string
          termo_aceito: boolean
          tripulacao: string | null
          troca_oleo: string
          updated_at: string
          vehicle_id: string
          vidros: string
        }
        Insert: {
          acessorios?: string
          avaria_descricao?: string | null
          avaria_nova?: string
          calibragem_ok?: string
          cambio?: string
          checklist_date?: string
          conducao_ok?: string
          created_at?: string
          created_by: string
          danos_veiculo?: string
          destino?: string | null
          detalhes?: Json | null
          driver_id?: string | null
          farois_lanternas?: string
          fluidos_ok?: string
          fotos?: Json | null
          id?: string
          itens_seguranca?: string
          kit_ok?: string
          limpeza_organizacao?: string
          motor?: string
          nivel_agua?: string
          nivel_oleo?: string
          observacoes?: string | null
          pneu_estepe?: string
          pneus?: string
          pneus_visual_ok?: string
          resultado?: string
          resultado_motivo?: string | null
          ruido_anormal?: string
          som?: string
          termo_aceito?: boolean
          tripulacao?: string | null
          troca_oleo?: string
          updated_at?: string
          vehicle_id: string
          vidros?: string
        }
        Update: {
          acessorios?: string
          avaria_descricao?: string | null
          avaria_nova?: string
          calibragem_ok?: string
          cambio?: string
          checklist_date?: string
          conducao_ok?: string
          created_at?: string
          created_by?: string
          danos_veiculo?: string
          destino?: string | null
          detalhes?: Json | null
          driver_id?: string | null
          farois_lanternas?: string
          fluidos_ok?: string
          fotos?: Json | null
          id?: string
          itens_seguranca?: string
          kit_ok?: string
          limpeza_organizacao?: string
          motor?: string
          nivel_agua?: string
          nivel_oleo?: string
          observacoes?: string | null
          pneu_estepe?: string
          pneus?: string
          pneus_visual_ok?: string
          resultado?: string
          resultado_motivo?: string | null
          ruido_anormal?: string
          som?: string
          termo_aceito?: boolean
          tripulacao?: string | null
          troca_oleo?: string
          updated_at?: string
          vehicle_id?: string
          vidros?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_checklists_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_checklists_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_maintenance_overrides: {
        Row: {
          active: boolean | null
          custom_km_interval: number | null
          custom_time_interval_days: number | null
          id: string
          maintenance_plan_id: string
          vehicle_id: string
        }
        Insert: {
          active?: boolean | null
          custom_km_interval?: number | null
          custom_time_interval_days?: number | null
          id?: string
          maintenance_plan_id: string
          vehicle_id: string
        }
        Update: {
          active?: boolean | null
          custom_km_interval?: number | null
          custom_time_interval_days?: number | null
          id?: string
          maintenance_plan_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_maintenance_overrides_maintenance_plan_id_fkey"
            columns: ["maintenance_plan_id"]
            isOneToOne: false
            referencedRelation: "maintenance_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_maintenance_overrides_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          adesao_id: string | null
          ano: number | null
          created_at: string
          id: string
          km_atual: number
          marca: string
          modelo: string
          placa: string
          status: Database["public"]["Enums"]["vehicle_status"]
          tipo: string | null
          updated_at: string
        }
        Insert: {
          adesao_id?: string | null
          ano?: number | null
          created_at?: string
          id?: string
          km_atual?: number
          marca: string
          modelo: string
          placa: string
          status?: Database["public"]["Enums"]["vehicle_status"]
          tipo?: string | null
          updated_at?: string
        }
        Update: {
          adesao_id?: string | null
          ano?: number | null
          created_at?: string
          id?: string
          km_atual?: number
          marca?: string
          modelo?: string
          placa?: string
          status?: Database["public"]["Enums"]["vehicle_status"]
          tipo?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "tecnico"
      driver_status: "ativo" | "inativo"
      ticket_priority: "baixa" | "media" | "alta" | "critica"
      ticket_status: "aberto" | "em_andamento" | "aguardando_peca" | "concluido"
      ticket_type: "preventiva" | "corretiva" | "nao_conformidade"
      vehicle_status: "disponivel" | "em_uso" | "manutencao"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "tecnico"],
      driver_status: ["ativo", "inativo"],
      ticket_priority: ["baixa", "media", "alta", "critica"],
      ticket_status: ["aberto", "em_andamento", "aguardando_peca", "concluido"],
      ticket_type: ["preventiva", "corretiva", "nao_conformidade"],
      vehicle_status: ["disponivel", "em_uso", "manutencao"],
    },
  },
} as const
