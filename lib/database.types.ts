export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      access_codes: {
        Row: {
          brokerage_id: string | null
          code: string
          created_at: string
          id: string
          is_active: boolean
          lender_institution_id: string | null
          role: Database["public"]["Enums"]["user_role"]
          uses_remaining: number | null
        }
        Insert: {
          brokerage_id?: string | null
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          lender_institution_id?: string | null
          role: Database["public"]["Enums"]["user_role"]
          uses_remaining?: number | null
        }
        Update: {
          brokerage_id?: string | null
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          lender_institution_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          uses_remaining?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "access_codes_brokerage_id_fkey"
            columns: ["brokerage_id"]
            isOneToOne: false
            referencedRelation: "brokerages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_codes_lender_institution_id_fkey"
            columns: ["lender_institution_id"]
            isOneToOne: false
            referencedRelation: "lender_institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_alerts: {
        Row: {
          created_at: string
          deal_id: string | null
          detection: Database["public"]["Enums"]["alert_detection"]
          flagged_content: string
          id: string
          is_reviewed: boolean
          message_id: string | null
          source: Database["public"]["Enums"]["alert_source"]
          user_id: string
        }
        Insert: {
          created_at?: string
          deal_id?: string | null
          detection: Database["public"]["Enums"]["alert_detection"]
          flagged_content: string
          id?: string
          is_reviewed?: boolean
          message_id?: string | null
          source: Database["public"]["Enums"]["alert_source"]
          user_id: string
        }
        Update: {
          created_at?: string
          deal_id?: string | null
          detection?: Database["public"]["Enums"]["alert_detection"]
          flagged_content?: string
          id?: string
          is_reviewed?: boolean
          message_id?: string | null
          source?: Database["public"]["Enums"]["alert_source"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_alerts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_alerts_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_alerts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_offers: {
        Row: {
          commission_bps: number
          commitment_turn_time_days: number | null
          created_at: string
          doc_review_turn_time_days: number | null
          end_date: string | null
          id: string
          is_active: boolean
          last_sent_at: string | null
          lender_fee_pct: number | null
          lender_id: string
          mortgage_product: Database["public"]["Enums"]["mortgage_product"]
          name: string
          rate: number
          rate_lock_days: number
          saved_filter_id: string
          sent_count: number
          updated_at: string
        }
        Insert: {
          commission_bps: number
          commitment_turn_time_days?: number | null
          created_at?: string
          doc_review_turn_time_days?: number | null
          end_date?: string | null
          id?: string
          is_active?: boolean
          last_sent_at?: string | null
          lender_fee_pct?: number | null
          lender_id: string
          mortgage_product: Database["public"]["Enums"]["mortgage_product"]
          name: string
          rate: number
          rate_lock_days: number
          saved_filter_id: string
          sent_count?: number
          updated_at?: string
        }
        Update: {
          commission_bps?: number
          commitment_turn_time_days?: number | null
          created_at?: string
          doc_review_turn_time_days?: number | null
          end_date?: string | null
          id?: string
          is_active?: boolean
          last_sent_at?: string | null
          lender_fee_pct?: number | null
          lender_id?: string
          mortgage_product?: Database["public"]["Enums"]["mortgage_product"]
          name?: string
          rate?: number
          rate_lock_days?: number
          saved_filter_id?: string
          sent_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_offers_lender_id_fkey"
            columns: ["lender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auto_offers_saved_filter_id_fkey"
            columns: ["saved_filter_id"]
            isOneToOne: false
            referencedRelation: "saved_filters"
            referencedColumns: ["id"]
          },
        ]
      }
      broker_blocked_institutions: {
        Row: {
          broker_id: string
          created_at: string
          institution_id: string
        }
        Insert: {
          broker_id: string
          created_at?: string
          institution_id: string
        }
        Update: {
          broker_id?: string
          created_at?: string
          institution_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "broker_blocked_institutions_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broker_blocked_institutions_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "lender_institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      brokerages: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      deal_chats: {
        Row: {
          broker_id: string
          created_at: string
          deal_id: string
          id: string
          lender_id: string
          updated_at: string
        }
        Insert: {
          broker_id: string
          created_at?: string
          deal_id: string
          id?: string
          lender_id: string
          updated_at?: string
        }
        Update: {
          broker_id?: string
          created_at?: string
          deal_id?: string
          id?: string
          lender_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_chats_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_chats_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_chats_lender_id_fkey"
            columns: ["lender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_credit_issues: {
        Row: {
          credit_issue: Database["public"]["Enums"]["credit_issue"]
          deal_id: string
        }
        Insert: {
          credit_issue: Database["public"]["Enums"]["credit_issue"]
          deal_id: string
        }
        Update: {
          credit_issue?: Database["public"]["Enums"]["credit_issue"]
          deal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_credit_issues_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_declines: {
        Row: {
          created_at: string
          deal_id: string
          lender_id: string
        }
        Insert: {
          created_at?: string
          deal_id: string
          lender_id: string
        }
        Update: {
          created_at?: string
          deal_id?: string
          lender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_declines_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_declines_lender_id_fkey"
            columns: ["lender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_documents: {
        Row: {
          checked_at: string | null
          created_at: string
          deal_id: string
          extracted_name: string | null
          file_name: string | null
          id: string
          kind: string
          name_matches: boolean | null
          name_variance: boolean | null
          storage_path: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          checked_at?: string | null
          created_at?: string
          deal_id: string
          extracted_name?: string | null
          file_name?: string | null
          id?: string
          kind: string
          name_matches?: boolean | null
          name_variance?: boolean | null
          storage_path: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          checked_at?: string | null
          created_at?: string
          deal_id?: string
          extracted_name?: string | null
          file_name?: string | null
          id?: string
          kind?: string
          name_matches?: boolean | null
          name_variance?: boolean | null
          storage_path?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_documents_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_down_payment_sources: {
        Row: {
          deal_id: string
          down_payment_source: Database["public"]["Enums"]["down_payment_source"]
        }
        Insert: {
          deal_id: string
          down_payment_source: Database["public"]["Enums"]["down_payment_source"]
        }
        Update: {
          deal_id?: string
          down_payment_source?: Database["public"]["Enums"]["down_payment_source"]
        }
        Relationships: [
          {
            foreignKeyName: "deal_down_payment_sources_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_identities: {
        Row: {
          borrower_first_name: string | null
          borrower_last_name: string | null
          deal_id: string
          property_address: string | null
          updated_at: string
        }
        Insert: {
          borrower_first_name?: string | null
          borrower_last_name?: string | null
          deal_id: string
          property_address?: string | null
          updated_at?: string
        }
        Update: {
          borrower_first_name?: string | null
          borrower_last_name?: string | null
          deal_id?: string
          property_address?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_identities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: true
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_income_types: {
        Row: {
          deal_id: string
          income_type: Database["public"]["Enums"]["income_type"]
        }
        Insert: {
          deal_id: string
          income_type: Database["public"]["Enums"]["income_type"]
        }
        Update: {
          deal_id?: string
          income_type?: Database["public"]["Enums"]["income_type"]
        }
        Relationships: [
          {
            foreignKeyName: "deal_income_types_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_number_counters: {
        Row: {
          last_number: number
          year: number
        }
        Insert: {
          last_number?: number
          year: number
        }
        Update: {
          last_number?: number
          year?: number
        }
        Relationships: []
      }
      deal_residency_statuses: {
        Row: {
          deal_id: string
          residency: Database["public"]["Enums"]["residency_status"]
        }
        Insert: {
          deal_id: string
          residency: Database["public"]["Enums"]["residency_status"]
        }
        Update: {
          deal_id?: string
          residency?: Database["public"]["Enums"]["residency_status"]
        }
        Relationships: [
          {
            foreignKeyName: "deal_residency_statuses_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          accepted_offer_id: string | null
          acres: number | null
          amortization_years: number | null
          archived: boolean
          assets_liquid_value: number | null
          assets_total_value: number | null
          bridge_loan_needed: boolean
          broker_id: string
          brokerage_id: string
          cashback: boolean
          city: string | null
          closing_date: string | null
          closing_date_flexible: boolean
          co_borrower_credit_score: number | null
          cof_date: string | null
          collateral_transfer: boolean
          cosignor_not_occupying: boolean
          cosignor_occupying: boolean
          created_at: string
          credit_notes: string | null
          deal_number: string | null
          door_count: number | null
          door_titles_count: number | null
          down_payment_notes: string | null
          dwelling_type: Database["public"]["Enums"]["dwelling_type"] | null
          expired_at: string | null
          first_and_heloc: boolean
          fixed_second: boolean
          foreign_income_country: string | null
          fthb: boolean
          gds: number | null
          general_notes: string | null
          guarantor: boolean
          heloc: boolean
          hobby_farm: boolean
          id: string
          income_notes: string | null
          insured: boolean
          lender_confirmed: boolean
          loan_amount: number | null
          location_type: Database["public"]["Enums"]["location_type"] | null
          ltv: number | null
          married_or_common_law: boolean
          medical_professional: boolean
          mortgage_position:
            | Database["public"]["Enums"]["mortgage_position"]
            | null
          mortgage_product:
            | Database["public"]["Enums"]["mortgage_product"]
            | null
          networth_program: boolean
          new_build: boolean
          new_to_canada: boolean
          no_lender_exceptions_required: boolean
          occupancy: Database["public"]["Enums"]["occupancy_type"] | null
          owns_other_properties: boolean
          prequal: boolean
          prequal_converted_at: string | null
          prequal_lender_notice_at: string | null
          previously_declined: boolean
          previously_declined_reason: string | null
          primary_credit_score: number | null
          property_value: number | null
          province: Database["public"]["Enums"]["province"] | null
          purchase_plus_improvements: boolean
          purpose: Database["public"]["Enums"]["transaction_purpose"] | null
          recreational_property: boolean
          reverse_mortgage: boolean
          septic: boolean
          spouse_not_on_application: boolean
          square_footage: number | null
          status: Database["public"]["Enums"]["deal_status"]
          submitted_at: string | null
          tds: number | null
          transaction_type:
            | Database["public"]["Enums"]["transaction_type"]
            | null
          transunion_being_used: boolean
          updated_at: string
          well_water: boolean
        }
        Insert: {
          accepted_offer_id?: string | null
          acres?: number | null
          amortization_years?: number | null
          archived?: boolean
          assets_liquid_value?: number | null
          assets_total_value?: number | null
          bridge_loan_needed?: boolean
          broker_id: string
          brokerage_id: string
          cashback?: boolean
          city?: string | null
          closing_date?: string | null
          closing_date_flexible?: boolean
          co_borrower_credit_score?: number | null
          cof_date?: string | null
          collateral_transfer?: boolean
          cosignor_not_occupying?: boolean
          cosignor_occupying?: boolean
          created_at?: string
          credit_notes?: string | null
          deal_number?: string | null
          door_count?: number | null
          door_titles_count?: number | null
          down_payment_notes?: string | null
          dwelling_type?: Database["public"]["Enums"]["dwelling_type"] | null
          expired_at?: string | null
          first_and_heloc?: boolean
          fixed_second?: boolean
          foreign_income_country?: string | null
          fthb?: boolean
          gds?: number | null
          general_notes?: string | null
          guarantor?: boolean
          heloc?: boolean
          hobby_farm?: boolean
          id?: string
          income_notes?: string | null
          insured?: boolean
          lender_confirmed?: boolean
          loan_amount?: number | null
          location_type?: Database["public"]["Enums"]["location_type"] | null
          ltv?: number | null
          married_or_common_law?: boolean
          medical_professional?: boolean
          mortgage_position?:
            | Database["public"]["Enums"]["mortgage_position"]
            | null
          mortgage_product?:
            | Database["public"]["Enums"]["mortgage_product"]
            | null
          networth_program?: boolean
          new_build?: boolean
          new_to_canada?: boolean
          no_lender_exceptions_required?: boolean
          occupancy?: Database["public"]["Enums"]["occupancy_type"] | null
          owns_other_properties?: boolean
          prequal?: boolean
          prequal_converted_at?: string | null
          prequal_lender_notice_at?: string | null
          previously_declined?: boolean
          previously_declined_reason?: string | null
          primary_credit_score?: number | null
          property_value?: number | null
          province?: Database["public"]["Enums"]["province"] | null
          purchase_plus_improvements?: boolean
          purpose?: Database["public"]["Enums"]["transaction_purpose"] | null
          recreational_property?: boolean
          reverse_mortgage?: boolean
          septic?: boolean
          spouse_not_on_application?: boolean
          square_footage?: number | null
          status?: Database["public"]["Enums"]["deal_status"]
          submitted_at?: string | null
          tds?: number | null
          transaction_type?:
            | Database["public"]["Enums"]["transaction_type"]
            | null
          transunion_being_used?: boolean
          updated_at?: string
          well_water?: boolean
        }
        Update: {
          accepted_offer_id?: string | null
          acres?: number | null
          amortization_years?: number | null
          archived?: boolean
          assets_liquid_value?: number | null
          assets_total_value?: number | null
          bridge_loan_needed?: boolean
          broker_id?: string
          brokerage_id?: string
          cashback?: boolean
          city?: string | null
          closing_date?: string | null
          closing_date_flexible?: boolean
          co_borrower_credit_score?: number | null
          cof_date?: string | null
          collateral_transfer?: boolean
          cosignor_not_occupying?: boolean
          cosignor_occupying?: boolean
          created_at?: string
          credit_notes?: string | null
          deal_number?: string | null
          door_count?: number | null
          door_titles_count?: number | null
          down_payment_notes?: string | null
          dwelling_type?: Database["public"]["Enums"]["dwelling_type"] | null
          expired_at?: string | null
          first_and_heloc?: boolean
          fixed_second?: boolean
          foreign_income_country?: string | null
          fthb?: boolean
          gds?: number | null
          general_notes?: string | null
          guarantor?: boolean
          heloc?: boolean
          hobby_farm?: boolean
          id?: string
          income_notes?: string | null
          insured?: boolean
          lender_confirmed?: boolean
          loan_amount?: number | null
          location_type?: Database["public"]["Enums"]["location_type"] | null
          ltv?: number | null
          married_or_common_law?: boolean
          medical_professional?: boolean
          mortgage_position?:
            | Database["public"]["Enums"]["mortgage_position"]
            | null
          mortgage_product?:
            | Database["public"]["Enums"]["mortgage_product"]
            | null
          networth_program?: boolean
          new_build?: boolean
          new_to_canada?: boolean
          no_lender_exceptions_required?: boolean
          occupancy?: Database["public"]["Enums"]["occupancy_type"] | null
          owns_other_properties?: boolean
          prequal?: boolean
          prequal_converted_at?: string | null
          prequal_lender_notice_at?: string | null
          previously_declined?: boolean
          previously_declined_reason?: string | null
          primary_credit_score?: number | null
          property_value?: number | null
          province?: Database["public"]["Enums"]["province"] | null
          purchase_plus_improvements?: boolean
          purpose?: Database["public"]["Enums"]["transaction_purpose"] | null
          recreational_property?: boolean
          reverse_mortgage?: boolean
          septic?: boolean
          spouse_not_on_application?: boolean
          square_footage?: number | null
          status?: Database["public"]["Enums"]["deal_status"]
          submitted_at?: string | null
          tds?: number | null
          transaction_type?:
            | Database["public"]["Enums"]["transaction_type"]
            | null
          transunion_being_used?: boolean
          updated_at?: string
          well_water?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "deals_accepted_offer_fk"
            columns: ["accepted_offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_brokerage_id_fkey"
            columns: ["brokerage_id"]
            isOneToOne: false
            referencedRelation: "brokerages"
            referencedColumns: ["id"]
          },
        ]
      }
      faqs: {
        Row: {
          audience: Database["public"]["Enums"]["user_role"]
          category: Database["public"]["Enums"]["faq_category"]
          content: string
          created_at: string
          id: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          audience: Database["public"]["Enums"]["user_role"]
          category: Database["public"]["Enums"]["faq_category"]
          content: string
          created_at?: string
          id?: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          audience?: Database["public"]["Enums"]["user_role"]
          category?: Database["public"]["Enums"]["faq_category"]
          content?: string
          created_at?: string
          id?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      invoice_number_counters: {
        Row: {
          day: string
          last_number: number
        }
        Insert: {
          day: string
          last_number?: number
        }
        Update: {
          day?: string
          last_number?: number
        }
        Relationships: []
      }
      invoices: {
        Row: {
          amount: number
          broker_name: string
          cancelled_at: string | null
          cancelled_reason: string | null
          client_name: string
          closing_date: string
          created_at: string
          deal_id: string
          document_name: string | null
          due_date: string
          id: string
          invoice_number: string
          lender_id: string
          loan_amount: number
          mortgage_product: Database["public"]["Enums"]["mortgage_product"]
          offer_id: string
          paid_at: string | null
          pdf_path: string | null
          platform_bps: number
          status: Database["public"]["Enums"]["invoice_status"]
          term_years: number | null
          updated_at: string
        }
        Insert: {
          amount: number
          broker_name: string
          cancelled_at?: string | null
          cancelled_reason?: string | null
          client_name: string
          closing_date: string
          created_at?: string
          deal_id: string
          document_name?: string | null
          due_date: string
          id?: string
          invoice_number: string
          lender_id: string
          loan_amount: number
          mortgage_product: Database["public"]["Enums"]["mortgage_product"]
          offer_id: string
          paid_at?: string | null
          pdf_path?: string | null
          platform_bps: number
          status?: Database["public"]["Enums"]["invoice_status"]
          term_years?: number | null
          updated_at?: string
        }
        Update: {
          amount?: number
          broker_name?: string
          cancelled_at?: string | null
          cancelled_reason?: string | null
          client_name?: string
          closing_date?: string
          created_at?: string
          deal_id?: string
          document_name?: string | null
          due_date?: string
          id?: string
          invoice_number?: string
          lender_id?: string
          loan_amount?: number
          mortgage_product?: Database["public"]["Enums"]["mortgage_product"]
          offer_id?: string
          paid_at?: string | null
          pdf_path?: string | null
          platform_bps?: number
          status?: Database["public"]["Enums"]["invoice_status"]
          term_years?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_lender_id_fkey"
            columns: ["lender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_documents: {
        Row: {
          content: string
          created_at: string
          id: string
          is_published: boolean
          type: Database["public"]["Enums"]["legal_doc_type"]
          updated_at: string
          version: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          is_published?: boolean
          type: Database["public"]["Enums"]["legal_doc_type"]
          updated_at?: string
          version: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          is_published?: boolean
          type?: Database["public"]["Enums"]["legal_doc_type"]
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      lender_blocked_brokerages: {
        Row: {
          brokerage_id: string
          created_at: string
          lender_id: string
        }
        Insert: {
          brokerage_id: string
          created_at?: string
          lender_id: string
        }
        Update: {
          brokerage_id?: string
          created_at?: string
          lender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lender_blocked_brokerages_brokerage_id_fkey"
            columns: ["brokerage_id"]
            isOneToOne: false
            referencedRelation: "brokerages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lender_blocked_brokerages_lender_id_fkey"
            columns: ["lender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lender_institutions: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      lender_logos: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          storage_path: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          storage_path: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          storage_path?: string
          updated_at?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          chat_id: string
          content: string
          created_at: string
          id: string
          is_invalid: boolean
          is_read: boolean
          sender_id: string
          sender_role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          chat_id: string
          content: string
          created_at?: string
          id?: string
          is_invalid?: boolean
          is_read?: boolean
          sender_id: string
          sender_role: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          chat_id?: string
          content?: string
          created_at?: string
          id?: string
          is_invalid?: boolean
          is_read?: boolean
          sender_id?: string
          sender_role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: [
          {
            foreignKeyName: "messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "deal_chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          deal_id: string | null
          id: string
          is_read: boolean
          offer_id: string | null
          recipient_id: string
          type: Database["public"]["Enums"]["notification_type"]
        }
        Insert: {
          body: string
          created_at?: string
          deal_id?: string | null
          id?: string
          is_read?: boolean
          offer_id?: string | null
          recipient_id: string
          type: Database["public"]["Enums"]["notification_type"]
        }
        Update: {
          body?: string
          created_at?: string
          deal_id?: string | null
          id?: string
          is_read?: boolean
          offer_id?: string | null
          recipient_id?: string
          type?: Database["public"]["Enums"]["notification_type"]
        }
        Relationships: [
          {
            foreignKeyName: "notifications_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          auto_offer_id: string | null
          comments: string | null
          commission_bps: number
          commitment_turn_time_days: number | null
          created_at: string
          deal_id: string
          decline_reason:
            | Database["public"]["Enums"]["offer_decline_reason"]
            | null
          doc_review_turn_time_days: number | null
          id: string
          is_auto: boolean
          lender_fee_pct: number | null
          lender_id: string
          mortgage_product: Database["public"]["Enums"]["mortgage_product"]
          offer_number: number
          rate: number
          rate_lock_days: number
          status: Database["public"]["Enums"]["offer_status"]
          updated_at: string
        }
        Insert: {
          auto_offer_id?: string | null
          comments?: string | null
          commission_bps: number
          commitment_turn_time_days?: number | null
          created_at?: string
          deal_id: string
          decline_reason?:
            | Database["public"]["Enums"]["offer_decline_reason"]
            | null
          doc_review_turn_time_days?: number | null
          id?: string
          is_auto?: boolean
          lender_fee_pct?: number | null
          lender_id: string
          mortgage_product: Database["public"]["Enums"]["mortgage_product"]
          offer_number: number
          rate: number
          rate_lock_days: number
          status?: Database["public"]["Enums"]["offer_status"]
          updated_at?: string
        }
        Update: {
          auto_offer_id?: string | null
          comments?: string | null
          commission_bps?: number
          commitment_turn_time_days?: number | null
          created_at?: string
          deal_id?: string
          decline_reason?:
            | Database["public"]["Enums"]["offer_decline_reason"]
            | null
          doc_review_turn_time_days?: number | null
          id?: string
          is_auto?: boolean
          lender_fee_pct?: number | null
          lender_id?: string
          mortgage_product?: Database["public"]["Enums"]["mortgage_product"]
          offer_number?: number
          rate?: number
          rate_lock_days?: number
          status?: Database["public"]["Enums"]["offer_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "offers_auto_offer_id_fkey"
            columns: ["auto_offer_id"]
            isOneToOne: false
            referencedRelation: "auto_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_lender_id_fkey"
            columns: ["lender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      penalty_settings: {
        Row: {
          id: number
          near_closing_days: number
          near_cof_days: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: number
          near_closing_days?: number
          near_cof_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: number
          near_closing_days?: number
          near_cof_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          brokerage_id: string | null
          confirm_delete_until: string | null
          created_at: string
          first_name: string
          id: string
          is_approved: boolean
          is_broker_admin: boolean
          last_name: string
          lender_institution_id: string | null
          notify_deal_expiring: boolean
          notify_email_enabled: boolean
          notify_filter_match: boolean
          notify_inapp_enabled: boolean
          notify_message: boolean
          notify_new_offer: boolean
          notify_offer_accepted: boolean
          notify_offer_received: boolean
          offer_switches_this_month: number
          penalty_active: boolean
          pending_approval: boolean
          phone: string | null
          rejected: boolean
          rejection_reason: string | null
          role: Database["public"]["Enums"]["user_role"]
          switch_month: string | null
          tos_accepted: boolean
          tos_accepted_at: string | null
          tos_version: string | null
          updated_at: string
        }
        Insert: {
          brokerage_id?: string | null
          confirm_delete_until?: string | null
          created_at?: string
          first_name: string
          id: string
          is_approved?: boolean
          is_broker_admin?: boolean
          last_name: string
          lender_institution_id?: string | null
          notify_deal_expiring?: boolean
          notify_email_enabled?: boolean
          notify_filter_match?: boolean
          notify_inapp_enabled?: boolean
          notify_message?: boolean
          notify_new_offer?: boolean
          notify_offer_accepted?: boolean
          notify_offer_received?: boolean
          offer_switches_this_month?: number
          penalty_active?: boolean
          pending_approval?: boolean
          phone?: string | null
          rejected?: boolean
          rejection_reason?: string | null
          role: Database["public"]["Enums"]["user_role"]
          switch_month?: string | null
          tos_accepted?: boolean
          tos_accepted_at?: string | null
          tos_version?: string | null
          updated_at?: string
        }
        Update: {
          brokerage_id?: string | null
          confirm_delete_until?: string | null
          created_at?: string
          first_name?: string
          id?: string
          is_approved?: boolean
          is_broker_admin?: boolean
          last_name?: string
          lender_institution_id?: string | null
          notify_deal_expiring?: boolean
          notify_email_enabled?: boolean
          notify_filter_match?: boolean
          notify_inapp_enabled?: boolean
          notify_message?: boolean
          notify_new_offer?: boolean
          notify_offer_accepted?: boolean
          notify_offer_received?: boolean
          offer_switches_this_month?: number
          penalty_active?: boolean
          pending_approval?: boolean
          phone?: string | null
          rejected?: boolean
          rejection_reason?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          switch_month?: string | null
          tos_accepted?: boolean
          tos_accepted_at?: string | null
          tos_version?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_brokerage_id_fkey"
            columns: ["brokerage_id"]
            isOneToOne: false
            referencedRelation: "brokerages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_lender_institution_id_fkey"
            columns: ["lender_institution_id"]
            isOneToOne: false
            referencedRelation: "lender_institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_filters: {
        Row: {
          acres_max: number | null
          amortization_max: number | null
          amortization_min: number | null
          assets_liquid_min: number | null
          assets_total_min: number | null
          created_at: string
          credit_issues: Database["public"]["Enums"]["credit_issue"][] | null
          credit_score_min: number | null
          down_payment_sources:
            | Database["public"]["Enums"]["down_payment_source"][]
            | null
          dwelling_type: Database["public"]["Enums"]["dwelling_type"] | null
          dwelling_types_excluded:
            | Database["public"]["Enums"]["dwelling_type"][]
            | null
          exclude_bridge_loan: boolean | null
          exclude_cashback: boolean | null
          exclude_collateral_transfer: boolean | null
          exclude_cosignor_not_occupying: boolean | null
          exclude_cosignor_occupying: boolean | null
          exclude_first_and_heloc: boolean | null
          exclude_fixed_second: boolean | null
          exclude_fthb: boolean | null
          exclude_guarantor: boolean | null
          exclude_heloc: boolean | null
          exclude_hobby_farm: boolean | null
          exclude_married_or_common_law: boolean
          exclude_medical_professional: boolean | null
          exclude_networth_program: boolean | null
          exclude_new_build: boolean | null
          exclude_new_to_canada: boolean | null
          exclude_prequal: boolean | null
          exclude_purchase_plus_improvements: boolean | null
          exclude_recreational: boolean | null
          exclude_reverse_mortgage: boolean
          exclude_septic: boolean | null
          exclude_spouse_not_on_application: boolean
          exclude_transunion: boolean
          exclude_well_water: boolean | null
          gds_max: number | null
          id: string
          income_types: Database["public"]["Enums"]["income_type"][] | null
          insured: boolean | null
          is_active: boolean
          lender_id: string
          loan_amount_max: number | null
          loan_amount_min: number | null
          location_type: Database["public"]["Enums"]["location_type"] | null
          ltv_max: number | null
          ltv_min: number | null
          max_door_titles: number | null
          max_doors: number | null
          mortgage_position:
            | Database["public"]["Enums"]["mortgage_position"]
            | null
          mortgage_product:
            | Database["public"]["Enums"]["mortgage_product"]
            | null
          name: string
          occupancy: Database["public"]["Enums"]["occupancy_type"] | null
          property_value_max: number | null
          property_value_min: number | null
          province: Database["public"]["Enums"]["province"] | null
          purpose: Database["public"]["Enums"]["transaction_purpose"] | null
          require_no_exceptions: boolean
          residency_statuses:
            | Database["public"]["Enums"]["residency_status"][]
            | null
          square_footage_min: number | null
          tds_max: number | null
          transaction_type:
            | Database["public"]["Enums"]["transaction_type"]
            | null
          updated_at: string
        }
        Insert: {
          acres_max?: number | null
          amortization_max?: number | null
          amortization_min?: number | null
          assets_liquid_min?: number | null
          assets_total_min?: number | null
          created_at?: string
          credit_issues?: Database["public"]["Enums"]["credit_issue"][] | null
          credit_score_min?: number | null
          down_payment_sources?:
            | Database["public"]["Enums"]["down_payment_source"][]
            | null
          dwelling_type?: Database["public"]["Enums"]["dwelling_type"] | null
          dwelling_types_excluded?:
            | Database["public"]["Enums"]["dwelling_type"][]
            | null
          exclude_bridge_loan?: boolean | null
          exclude_cashback?: boolean | null
          exclude_collateral_transfer?: boolean | null
          exclude_cosignor_not_occupying?: boolean | null
          exclude_cosignor_occupying?: boolean | null
          exclude_first_and_heloc?: boolean | null
          exclude_fixed_second?: boolean | null
          exclude_fthb?: boolean | null
          exclude_guarantor?: boolean | null
          exclude_heloc?: boolean | null
          exclude_hobby_farm?: boolean | null
          exclude_married_or_common_law?: boolean
          exclude_medical_professional?: boolean | null
          exclude_networth_program?: boolean | null
          exclude_new_build?: boolean | null
          exclude_new_to_canada?: boolean | null
          exclude_prequal?: boolean | null
          exclude_purchase_plus_improvements?: boolean | null
          exclude_recreational?: boolean | null
          exclude_reverse_mortgage?: boolean
          exclude_septic?: boolean | null
          exclude_spouse_not_on_application?: boolean
          exclude_transunion?: boolean
          exclude_well_water?: boolean | null
          gds_max?: number | null
          id?: string
          income_types?: Database["public"]["Enums"]["income_type"][] | null
          insured?: boolean | null
          is_active?: boolean
          lender_id: string
          loan_amount_max?: number | null
          loan_amount_min?: number | null
          location_type?: Database["public"]["Enums"]["location_type"] | null
          ltv_max?: number | null
          ltv_min?: number | null
          max_door_titles?: number | null
          max_doors?: number | null
          mortgage_position?:
            | Database["public"]["Enums"]["mortgage_position"]
            | null
          mortgage_product?:
            | Database["public"]["Enums"]["mortgage_product"]
            | null
          name: string
          occupancy?: Database["public"]["Enums"]["occupancy_type"] | null
          property_value_max?: number | null
          property_value_min?: number | null
          province?: Database["public"]["Enums"]["province"] | null
          purpose?: Database["public"]["Enums"]["transaction_purpose"] | null
          require_no_exceptions?: boolean
          residency_statuses?:
            | Database["public"]["Enums"]["residency_status"][]
            | null
          square_footage_min?: number | null
          tds_max?: number | null
          transaction_type?:
            | Database["public"]["Enums"]["transaction_type"]
            | null
          updated_at?: string
        }
        Update: {
          acres_max?: number | null
          amortization_max?: number | null
          amortization_min?: number | null
          assets_liquid_min?: number | null
          assets_total_min?: number | null
          created_at?: string
          credit_issues?: Database["public"]["Enums"]["credit_issue"][] | null
          credit_score_min?: number | null
          down_payment_sources?:
            | Database["public"]["Enums"]["down_payment_source"][]
            | null
          dwelling_type?: Database["public"]["Enums"]["dwelling_type"] | null
          dwelling_types_excluded?:
            | Database["public"]["Enums"]["dwelling_type"][]
            | null
          exclude_bridge_loan?: boolean | null
          exclude_cashback?: boolean | null
          exclude_collateral_transfer?: boolean | null
          exclude_cosignor_not_occupying?: boolean | null
          exclude_cosignor_occupying?: boolean | null
          exclude_first_and_heloc?: boolean | null
          exclude_fixed_second?: boolean | null
          exclude_fthb?: boolean | null
          exclude_guarantor?: boolean | null
          exclude_heloc?: boolean | null
          exclude_hobby_farm?: boolean | null
          exclude_married_or_common_law?: boolean
          exclude_medical_professional?: boolean | null
          exclude_networth_program?: boolean | null
          exclude_new_build?: boolean | null
          exclude_new_to_canada?: boolean | null
          exclude_prequal?: boolean | null
          exclude_purchase_plus_improvements?: boolean | null
          exclude_recreational?: boolean | null
          exclude_reverse_mortgage?: boolean
          exclude_septic?: boolean | null
          exclude_spouse_not_on_application?: boolean
          exclude_transunion?: boolean
          exclude_well_water?: boolean | null
          gds_max?: number | null
          id?: string
          income_types?: Database["public"]["Enums"]["income_type"][] | null
          insured?: boolean | null
          is_active?: boolean
          lender_id?: string
          loan_amount_max?: number | null
          loan_amount_min?: number | null
          location_type?: Database["public"]["Enums"]["location_type"] | null
          ltv_max?: number | null
          ltv_min?: number | null
          max_door_titles?: number | null
          max_doors?: number | null
          mortgage_position?:
            | Database["public"]["Enums"]["mortgage_position"]
            | null
          mortgage_product?:
            | Database["public"]["Enums"]["mortgage_product"]
            | null
          name?: string
          occupancy?: Database["public"]["Enums"]["occupancy_type"] | null
          property_value_max?: number | null
          property_value_min?: number | null
          province?: Database["public"]["Enums"]["province"] | null
          purpose?: Database["public"]["Enums"]["transaction_purpose"] | null
          require_no_exceptions?: boolean
          residency_statuses?:
            | Database["public"]["Enums"]["residency_status"][]
            | null
          square_footage_min?: number | null
          tds_max?: number | null
          transaction_type?:
            | Database["public"]["Enums"]["transaction_type"]
            | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_filters_lender_id_fkey"
            columns: ["lender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      surveys: {
        Row: {
          broker_id: string
          brokerage_id: string | null
          closed_with_lender: boolean | null
          commitment_on_time: boolean | null
          completed_at: string | null
          created_at: string
          deal_id: string
          doc_review_on_time: boolean | null
          funded_on_time: boolean | null
          id: string
          is_completed: boolean
          lender_id: string
          lender_institution_id: string | null
          not_closed_reason: string | null
          offer_id: string | null
          satisfaction: number | null
        }
        Insert: {
          broker_id: string
          brokerage_id?: string | null
          closed_with_lender?: boolean | null
          commitment_on_time?: boolean | null
          completed_at?: string | null
          created_at?: string
          deal_id: string
          doc_review_on_time?: boolean | null
          funded_on_time?: boolean | null
          id?: string
          is_completed?: boolean
          lender_id: string
          lender_institution_id?: string | null
          not_closed_reason?: string | null
          offer_id?: string | null
          satisfaction?: number | null
        }
        Update: {
          broker_id?: string
          brokerage_id?: string | null
          closed_with_lender?: boolean | null
          commitment_on_time?: boolean | null
          completed_at?: string | null
          created_at?: string
          deal_id?: string
          doc_review_on_time?: boolean | null
          funded_on_time?: boolean | null
          id?: string
          is_completed?: boolean
          lender_id?: string
          lender_institution_id?: string | null
          not_closed_reason?: string | null
          offer_id?: string | null
          satisfaction?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "surveys_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "surveys_brokerage_id_fkey"
            columns: ["brokerage_id"]
            isOneToOne: false
            referencedRelation: "brokerages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "surveys_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: true
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "surveys_lender_id_fkey"
            columns: ["lender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "surveys_lender_institution_id_fkey"
            columns: ["lender_institution_id"]
            isOneToOne: false
            referencedRelation: "lender_institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "surveys_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_offer: {
        Args: { p_offer_id: string }
        Returns: {
          auto_offer_id: string | null
          comments: string | null
          commission_bps: number
          commitment_turn_time_days: number | null
          created_at: string
          deal_id: string
          decline_reason:
            | Database["public"]["Enums"]["offer_decline_reason"]
            | null
          doc_review_turn_time_days: number | null
          id: string
          is_auto: boolean
          lender_fee_pct: number | null
          lender_id: string
          mortgage_product: Database["public"]["Enums"]["mortgage_product"]
          offer_number: number
          rate: number
          rate_lock_days: number
          status: Database["public"]["Enums"]["offer_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "offers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      accepted_lender_for_deal: {
        Args: { p_deal_id: string }
        Returns: {
          first_name: string
          institution: string
          last_name: string
          lender_id: string
        }[]
      }
      admin_analytics: { Args: never; Returns: Json }
      admin_lender_ratings: {
        Args: never
        Returns: {
          avg_satisfaction: number
          first_name: string
          institution: string
          last_name: string
          lender_id: string
          penalty_active: boolean
          survey_count: number
        }[]
      }
      approve_lender: { Args: { p_lender_id: string }; Returns: undefined }
      best_match_for: {
        Args: { p_deal_id: string; p_lender: string }
        Returns: Record<string, unknown>
      }
      cancel_invoice: {
        Args: { p_invoice_id: string; p_reason: string }
        Returns: {
          amount: number
          broker_name: string
          cancelled_at: string | null
          cancelled_reason: string | null
          client_name: string
          closing_date: string
          created_at: string
          deal_id: string
          document_name: string | null
          due_date: string
          id: string
          invoice_number: string
          lender_id: string
          loan_amount: number
          mortgage_product: Database["public"]["Enums"]["mortgage_product"]
          offer_id: string
          paid_at: string | null
          pdf_path: string | null
          platform_bps: number
          status: Database["public"]["Enums"]["invoice_status"]
          term_years: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      convert_prequal_to_live: {
        Args: {
          p_closing_date: string
          p_cof_date?: string
          p_deal_id: string
          p_property_address: string
        }
        Returns: {
          accepted_offer_id: string | null
          acres: number | null
          amortization_years: number | null
          archived: boolean
          assets_liquid_value: number | null
          assets_total_value: number | null
          bridge_loan_needed: boolean
          broker_id: string
          brokerage_id: string
          cashback: boolean
          city: string | null
          closing_date: string | null
          closing_date_flexible: boolean
          co_borrower_credit_score: number | null
          cof_date: string | null
          collateral_transfer: boolean
          cosignor_not_occupying: boolean
          cosignor_occupying: boolean
          created_at: string
          credit_notes: string | null
          deal_number: string | null
          door_count: number | null
          door_titles_count: number | null
          down_payment_notes: string | null
          dwelling_type: Database["public"]["Enums"]["dwelling_type"] | null
          expired_at: string | null
          first_and_heloc: boolean
          fixed_second: boolean
          foreign_income_country: string | null
          fthb: boolean
          gds: number | null
          general_notes: string | null
          guarantor: boolean
          heloc: boolean
          hobby_farm: boolean
          id: string
          income_notes: string | null
          insured: boolean
          lender_confirmed: boolean
          loan_amount: number | null
          location_type: Database["public"]["Enums"]["location_type"] | null
          ltv: number | null
          married_or_common_law: boolean
          medical_professional: boolean
          mortgage_position:
            | Database["public"]["Enums"]["mortgage_position"]
            | null
          mortgage_product:
            | Database["public"]["Enums"]["mortgage_product"]
            | null
          networth_program: boolean
          new_build: boolean
          new_to_canada: boolean
          no_lender_exceptions_required: boolean
          occupancy: Database["public"]["Enums"]["occupancy_type"] | null
          owns_other_properties: boolean
          prequal: boolean
          prequal_converted_at: string | null
          prequal_lender_notice_at: string | null
          previously_declined: boolean
          previously_declined_reason: string | null
          primary_credit_score: number | null
          property_value: number | null
          province: Database["public"]["Enums"]["province"] | null
          purchase_plus_improvements: boolean
          purpose: Database["public"]["Enums"]["transaction_purpose"] | null
          recreational_property: boolean
          reverse_mortgage: boolean
          septic: boolean
          spouse_not_on_application: boolean
          square_footage: number | null
          status: Database["public"]["Enums"]["deal_status"]
          submitted_at: string | null
          tds: number | null
          transaction_type:
            | Database["public"]["Enums"]["transaction_type"]
            | null
          transunion_being_used: boolean
          updated_at: string
          well_water: boolean
        }
        SetofOptions: {
          from: "*"
          to: "deals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_role_of: {
        Args: { uid: string }
        Returns: Database["public"]["Enums"]["user_role"]
      }
      deal_allows_auto_offer: {
        Args: { d: Database["public"]["Tables"]["deals"]["Row"] }
        Returns: boolean
      }
      deal_has_offers: { Args: { p_deal_id: string }; Returns: boolean }
      decline_deal: { Args: { p_deal_id: string }; Returns: undefined }
      documents_to_purge: {
        Args: never
        Returns: {
          id: string
          storage_path: string
        }[]
      }
      edit_offer: {
        Args: {
          p_comments?: string
          p_commission_bps: number
          p_commitment_turn_time_days?: number
          p_doc_review_turn_time_days?: number
          p_lender_fee_pct?: number
          p_mortgage_product: Database["public"]["Enums"]["mortgage_product"]
          p_offer_id: string
          p_rate: number
          p_rate_lock_days: number
        }
        Returns: {
          auto_offer_id: string | null
          comments: string | null
          commission_bps: number
          commitment_turn_time_days: number | null
          created_at: string
          deal_id: string
          decline_reason:
            | Database["public"]["Enums"]["offer_decline_reason"]
            | null
          doc_review_turn_time_days: number | null
          id: string
          is_auto: boolean
          lender_fee_pct: number | null
          lender_id: string
          mortgage_product: Database["public"]["Enums"]["mortgage_product"]
          offer_number: number
          rate: number
          rate_lock_days: number
          status: Database["public"]["Enums"]["offer_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "offers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      expired_deals_for_lender: {
        Args: never
        Returns: {
          amortization_years: number
          city: string
          closing_date: string
          cof_date: string
          deal_number: string
          dwelling_type: Database["public"]["Enums"]["dwelling_type"]
          expired_at: string
          id: string
          insured: boolean
          loan_amount: number
          ltv: number
          match_fails: string[]
          match_filter: string
          match_pct: number
          mortgage_product: Database["public"]["Enums"]["mortgage_product"]
          property_value: number
          province: Database["public"]["Enums"]["province"]
          purpose: Database["public"]["Enums"]["transaction_purpose"]
          submitted_at: string
        }[]
      }
      i_am_approved_lender: { Args: never; Returns: boolean }
      i_am_broker_admin: { Args: never; Returns: boolean }
      i_am_penalized_lender: { Args: never; Returns: boolean }
      i_offered_on: { Args: { p_deal_id: string }; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      job_apply_rating_penalties: { Args: never; Returns: number }
      job_archive_expired_deals: { Args: never; Returns: number }
      job_auto_offer_digest: { Args: never; Returns: undefined }
      job_expire_old_deals: { Args: never; Returns: number }
      job_purge_expired_documents: { Args: never; Returns: undefined }
      job_reset_monthly_switches: { Args: never; Returns: number }
      job_trigger_closing_surveys: { Args: never; Returns: number }
      lender_can_see_deal: {
        Args: { d: Database["public"]["Tables"]["deals"]["Row"] }
        Returns: boolean
      }
      make_offer: {
        Args: {
          p_comments?: string
          p_commission_bps: number
          p_commitment_turn_time_days?: number
          p_deal_id: string
          p_doc_review_turn_time_days?: number
          p_lender_fee_pct?: number
          p_mortgage_product: Database["public"]["Enums"]["mortgage_product"]
          p_rate: number
          p_rate_lock_days: number
        }
        Returns: {
          auto_offer_id: string | null
          comments: string | null
          commission_bps: number
          commitment_turn_time_days: number | null
          created_at: string
          deal_id: string
          decline_reason:
            | Database["public"]["Enums"]["offer_decline_reason"]
            | null
          doc_review_turn_time_days: number | null
          id: string
          is_auto: boolean
          lender_fee_pct: number | null
          lender_id: string
          mortgage_product: Database["public"]["Enums"]["mortgage_product"]
          offer_number: number
          rate: number
          rate_lock_days: number
          status: Database["public"]["Enums"]["offer_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "offers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_chat_read: { Args: { p_chat_id: string }; Returns: undefined }
      mark_invoice_paid: {
        Args: { p_invoice_id: string }
        Returns: {
          amount: number
          broker_name: string
          cancelled_at: string | null
          cancelled_reason: string | null
          client_name: string
          closing_date: string
          created_at: string
          deal_id: string
          document_name: string | null
          due_date: string
          id: string
          invoice_number: string
          lender_id: string
          loan_amount: number
          mortgage_product: Database["public"]["Enums"]["mortgage_product"]
          offer_id: string
          paid_at: string | null
          pdf_path: string | null
          platform_bps: number
          status: Database["public"]["Enums"]["invoice_status"]
          term_years: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      match_percentage: {
        Args: {
          d: Database["public"]["Tables"]["deals"]["Row"]
          sf: Database["public"]["Tables"]["saved_filters"]["Row"]
        }
        Returns: Record<string, unknown>
      }
      maturing_deals_filtered: {
        Args: {
          p_acres_max?: number
          p_amortization_max?: number
          p_amortization_min?: number
          p_assets_liquid_min?: number
          p_assets_total_min?: number
          p_credit_issues_excluded?: Database["public"]["Enums"]["credit_issue"][]
          p_credit_score_min?: number
          p_down_payment_sources_excluded?: Database["public"]["Enums"]["down_payment_source"][]
          p_dwelling_type?: Database["public"]["Enums"]["dwelling_type"]
          p_dwelling_types_excluded?: Database["public"]["Enums"]["dwelling_type"][]
          p_gds_max?: number
          p_income_types_excluded?: Database["public"]["Enums"]["income_type"][]
          p_insured?: boolean
          p_loan_amount_max?: number
          p_loan_amount_min?: number
          p_location_type?: Database["public"]["Enums"]["location_type"]
          p_ltv_max?: number
          p_ltv_min?: number
          p_max_door_titles?: number
          p_max_doors?: number
          p_mortgage_position?: Database["public"]["Enums"]["mortgage_position"]
          p_mortgage_product?: Database["public"]["Enums"]["mortgage_product"]
          p_occupancy?: Database["public"]["Enums"]["occupancy_type"]
          p_others_excluded?: string[]
          p_property_value_max?: number
          p_property_value_min?: number
          p_province?: Database["public"]["Enums"]["province"]
          p_purpose?: Database["public"]["Enums"]["transaction_purpose"]
          p_require_no_exceptions?: boolean
          p_residency_statuses_excluded?: Database["public"]["Enums"]["residency_status"][]
          p_square_footage_min?: number
          p_tds_max?: number
          p_transaction_type?: Database["public"]["Enums"]["transaction_type"]
        }
        Returns: {
          acres: number
          amortization_years: number
          assets_liquid_value: number
          assets_total_value: number
          bridge_loan_needed: boolean
          cashback: boolean
          city: string
          closing_date: string
          closing_date_flexible: boolean
          co_borrower_credit_score: number
          cof_date: string
          collateral_transfer: boolean
          cosignor_not_occupying: boolean
          cosignor_occupying: boolean
          credit_issues: Database["public"]["Enums"]["credit_issue"][]
          credit_notes: string
          deal_number: string
          door_count: number
          door_titles_count: number
          down_payment_notes: string
          down_payment_sources: Database["public"]["Enums"]["down_payment_source"][]
          dwelling_type: Database["public"]["Enums"]["dwelling_type"]
          first_and_heloc: boolean
          fixed_second: boolean
          foreign_income_country: string
          fthb: boolean
          gds: number
          general_notes: string
          guarantor: boolean
          heloc: boolean
          hobby_farm: boolean
          id: string
          income_notes: string
          income_types: Database["public"]["Enums"]["income_type"][]
          insured: boolean
          loan_amount: number
          location_type: Database["public"]["Enums"]["location_type"]
          ltv: number
          married_or_common_law: boolean
          match_fails: string[]
          match_filter: string
          match_pct: number
          medical_professional: boolean
          mortgage_position: Database["public"]["Enums"]["mortgage_position"]
          mortgage_product: Database["public"]["Enums"]["mortgage_product"]
          networth_program: boolean
          new_build: boolean
          new_to_canada: boolean
          no_lender_exceptions_required: boolean
          occupancy: Database["public"]["Enums"]["occupancy_type"]
          owns_other_properties: boolean
          prequal: boolean
          previously_declined: boolean
          previously_declined_reason: string
          primary_credit_score: number
          property_value: number
          province: Database["public"]["Enums"]["province"]
          purchase_plus_improvements: boolean
          purpose: Database["public"]["Enums"]["transaction_purpose"]
          recreational_property: boolean
          residency_statuses: Database["public"]["Enums"]["residency_status"][]
          reverse_mortgage: boolean
          septic: boolean
          spouse_not_on_application: boolean
          square_footage: number
          submitted_at: string
          tds: number
          transaction_type: Database["public"]["Enums"]["transaction_type"]
          transunion_being_used: boolean
          well_water: boolean
        }[]
      }
      maturing_deals_for_lender: {
        Args: { p_filter_id?: string }
        Returns: {
          acres: number
          amortization_years: number
          assets_liquid_value: number
          assets_total_value: number
          bridge_loan_needed: boolean
          cashback: boolean
          city: string
          closing_date: string
          closing_date_flexible: boolean
          co_borrower_credit_score: number
          cof_date: string
          collateral_transfer: boolean
          cosignor_not_occupying: boolean
          cosignor_occupying: boolean
          credit_issues: Database["public"]["Enums"]["credit_issue"][]
          credit_notes: string
          deal_number: string
          door_count: number
          door_titles_count: number
          down_payment_notes: string
          down_payment_sources: Database["public"]["Enums"]["down_payment_source"][]
          dwelling_type: Database["public"]["Enums"]["dwelling_type"]
          first_and_heloc: boolean
          fixed_second: boolean
          foreign_income_country: string
          fthb: boolean
          gds: number
          general_notes: string
          guarantor: boolean
          heloc: boolean
          hobby_farm: boolean
          id: string
          income_notes: string
          income_types: Database["public"]["Enums"]["income_type"][]
          insured: boolean
          loan_amount: number
          location_type: Database["public"]["Enums"]["location_type"]
          ltv: number
          married_or_common_law: boolean
          match_fails: string[]
          match_filter: string
          match_pct: number
          medical_professional: boolean
          mortgage_position: Database["public"]["Enums"]["mortgage_position"]
          mortgage_product: Database["public"]["Enums"]["mortgage_product"]
          networth_program: boolean
          new_build: boolean
          new_to_canada: boolean
          no_lender_exceptions_required: boolean
          occupancy: Database["public"]["Enums"]["occupancy_type"]
          owns_other_properties: boolean
          prequal: boolean
          previously_declined: boolean
          previously_declined_reason: string
          primary_credit_score: number
          property_value: number
          province: Database["public"]["Enums"]["province"]
          purchase_plus_improvements: boolean
          purpose: Database["public"]["Enums"]["transaction_purpose"]
          recreational_property: boolean
          residency_statuses: Database["public"]["Enums"]["residency_status"][]
          reverse_mortgage: boolean
          septic: boolean
          spouse_not_on_application: boolean
          square_footage: number
          submitted_at: string
          tds: number
          transaction_type: Database["public"]["Enums"]["transaction_type"]
          transunion_being_used: boolean
          well_water: boolean
        }[]
      }
      my_brokerage: { Args: never; Returns: string }
      my_chat_threads: {
        Args: never
        Returns: {
          chat_id: string
          counterparty_ordinal: number
          deal_id: string
          deal_number: string
          deal_status: Database["public"]["Enums"]["deal_status"]
          i_am_broker: boolean
          last_at: string
          last_content: string
          last_sender_role: Database["public"]["Enums"]["user_role"]
          unread: number
        }[]
      }
      my_institution: { Args: never; Returns: string }
      my_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      next_deal_number: { Args: never; Returns: string }
      next_invoice_number: { Args: never; Returns: string }
      notify: {
        Args: {
          nbody: string
          ndeal?: string
          noffer?: string
          ntype: Database["public"]["Enums"]["notification_type"]
          recipient: string
        }
        Returns: undefined
      }
      open_deals_filtered: {
        Args: {
          p_acres_max?: number
          p_amortization_max?: number
          p_amortization_min?: number
          p_assets_liquid_min?: number
          p_assets_total_min?: number
          p_credit_issues_excluded?: Database["public"]["Enums"]["credit_issue"][]
          p_credit_score_min?: number
          p_down_payment_sources_excluded?: Database["public"]["Enums"]["down_payment_source"][]
          p_dwelling_type?: Database["public"]["Enums"]["dwelling_type"]
          p_dwelling_types_excluded?: Database["public"]["Enums"]["dwelling_type"][]
          p_gds_max?: number
          p_income_types_excluded?: Database["public"]["Enums"]["income_type"][]
          p_insured?: boolean
          p_loan_amount_max?: number
          p_loan_amount_min?: number
          p_location_type?: Database["public"]["Enums"]["location_type"]
          p_ltv_max?: number
          p_ltv_min?: number
          p_max_door_titles?: number
          p_max_doors?: number
          p_mortgage_position?: Database["public"]["Enums"]["mortgage_position"]
          p_mortgage_product?: Database["public"]["Enums"]["mortgage_product"]
          p_occupancy?: Database["public"]["Enums"]["occupancy_type"]
          p_others_excluded?: string[]
          p_property_value_max?: number
          p_property_value_min?: number
          p_province?: Database["public"]["Enums"]["province"]
          p_purpose?: Database["public"]["Enums"]["transaction_purpose"]
          p_require_no_exceptions?: boolean
          p_residency_statuses_excluded?: Database["public"]["Enums"]["residency_status"][]
          p_square_footage_min?: number
          p_tds_max?: number
          p_transaction_type?: Database["public"]["Enums"]["transaction_type"]
        }
        Returns: {
          acres: number
          amortization_years: number
          assets_liquid_value: number
          assets_total_value: number
          bridge_loan_needed: boolean
          cashback: boolean
          city: string
          closing_date: string
          closing_date_flexible: boolean
          co_borrower_credit_score: number
          cof_date: string
          collateral_transfer: boolean
          cosignor_not_occupying: boolean
          cosignor_occupying: boolean
          credit_issues: Database["public"]["Enums"]["credit_issue"][]
          credit_notes: string
          deal_number: string
          door_count: number
          door_titles_count: number
          down_payment_notes: string
          down_payment_sources: Database["public"]["Enums"]["down_payment_source"][]
          dwelling_type: Database["public"]["Enums"]["dwelling_type"]
          first_and_heloc: boolean
          fixed_second: boolean
          foreign_income_country: string
          fthb: boolean
          gds: number
          general_notes: string
          guarantor: boolean
          heloc: boolean
          hobby_farm: boolean
          id: string
          income_notes: string
          income_types: Database["public"]["Enums"]["income_type"][]
          insured: boolean
          loan_amount: number
          location_type: Database["public"]["Enums"]["location_type"]
          ltv: number
          married_or_common_law: boolean
          medical_professional: boolean
          mortgage_position: Database["public"]["Enums"]["mortgage_position"]
          mortgage_product: Database["public"]["Enums"]["mortgage_product"]
          networth_program: boolean
          new_build: boolean
          new_to_canada: boolean
          no_lender_exceptions_required: boolean
          occupancy: Database["public"]["Enums"]["occupancy_type"]
          owns_other_properties: boolean
          prequal: boolean
          previously_declined: boolean
          previously_declined_reason: string
          primary_credit_score: number
          property_value: number
          province: Database["public"]["Enums"]["province"]
          purchase_plus_improvements: boolean
          purpose: Database["public"]["Enums"]["transaction_purpose"]
          recreational_property: boolean
          residency_statuses: Database["public"]["Enums"]["residency_status"][]
          reverse_mortgage: boolean
          septic: boolean
          spouse_not_on_application: boolean
          square_footage: number
          submitted_at: string
          tds: number
          transaction_type: Database["public"]["Enums"]["transaction_type"]
          transunion_being_used: boolean
          well_water: boolean
        }[]
      }
      open_deals_for_lender: {
        Args: { p_filter_id?: string }
        Returns: {
          acres: number
          amortization_years: number
          assets_liquid_value: number
          assets_total_value: number
          bridge_loan_needed: boolean
          cashback: boolean
          city: string
          closing_date: string
          closing_date_flexible: boolean
          co_borrower_credit_score: number
          cof_date: string
          collateral_transfer: boolean
          cosignor_not_occupying: boolean
          cosignor_occupying: boolean
          credit_issues: Database["public"]["Enums"]["credit_issue"][]
          credit_notes: string
          deal_number: string
          door_count: number
          door_titles_count: number
          down_payment_notes: string
          down_payment_sources: Database["public"]["Enums"]["down_payment_source"][]
          dwelling_type: Database["public"]["Enums"]["dwelling_type"]
          first_and_heloc: boolean
          fixed_second: boolean
          foreign_income_country: string
          fthb: boolean
          gds: number
          general_notes: string
          guarantor: boolean
          heloc: boolean
          hobby_farm: boolean
          id: string
          income_notes: string
          income_types: Database["public"]["Enums"]["income_type"][]
          insured: boolean
          loan_amount: number
          location_type: Database["public"]["Enums"]["location_type"]
          ltv: number
          married_or_common_law: boolean
          medical_professional: boolean
          mortgage_position: Database["public"]["Enums"]["mortgage_position"]
          mortgage_product: Database["public"]["Enums"]["mortgage_product"]
          networth_program: boolean
          new_build: boolean
          new_to_canada: boolean
          no_lender_exceptions_required: boolean
          occupancy: Database["public"]["Enums"]["occupancy_type"]
          owns_other_properties: boolean
          prequal: boolean
          previously_declined: boolean
          previously_declined_reason: string
          primary_credit_score: number
          property_value: number
          province: Database["public"]["Enums"]["province"]
          purchase_plus_improvements: boolean
          purpose: Database["public"]["Enums"]["transaction_purpose"]
          recreational_property: boolean
          residency_statuses: Database["public"]["Enums"]["residency_status"][]
          reverse_mortgage: boolean
          septic: boolean
          spouse_not_on_application: boolean
          square_footage: number
          submitted_at: string
          tds: number
          transaction_type: Database["public"]["Enums"]["transaction_type"]
          transunion_being_used: boolean
          well_water: boolean
        }[]
      }
      platform_bps_for: {
        Args: { p: Database["public"]["Enums"]["mortgage_product"] }
        Returns: number
      }
      product_years: {
        Args: { p: Database["public"]["Enums"]["mortgage_product"] }
        Returns: number
      }
      reject_lender: {
        Args: { p_lender_id: string; p_reason: string }
        Returns: undefined
      }
      saved_filter_matches: {
        Args: {
          d: Database["public"]["Tables"]["deals"]["Row"]
          sf: Database["public"]["Tables"]["saved_filters"]["Row"]
        }
        Returns: boolean
      }
      scan_and_log: {
        Args: {
          p_deal_id?: string
          p_source: Database["public"]["Enums"]["alert_source"]
          p_text: string
        }
        Returns: string
      }
      scan_contact_info: {
        Args: { p_first?: string; p_last?: string; p_text: string }
        Returns: string
      }
      send_auto_offers: { Args: { p_deal_id: string }; Returns: number }
      send_deal_message: {
        Args: { p_content: string; p_deal_id: string; p_lender_id?: string }
        Returns: {
          chat_id: string
          content: string
          created_at: string
          id: string
          is_invalid: boolean
          is_read: boolean
          sender_id: string
          sender_role: Database["public"]["Enums"]["user_role"]
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_penalty_thresholds: {
        Args: { p_near_closing_days: number; p_near_cof_days: number }
        Returns: {
          id: number
          near_closing_days: number
          near_cof_days: number
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "penalty_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_deal: {
        Args: { p_deal_id: string }
        Returns: {
          accepted_offer_id: string | null
          acres: number | null
          amortization_years: number | null
          archived: boolean
          assets_liquid_value: number | null
          assets_total_value: number | null
          bridge_loan_needed: boolean
          broker_id: string
          brokerage_id: string
          cashback: boolean
          city: string | null
          closing_date: string | null
          closing_date_flexible: boolean
          co_borrower_credit_score: number | null
          cof_date: string | null
          collateral_transfer: boolean
          cosignor_not_occupying: boolean
          cosignor_occupying: boolean
          created_at: string
          credit_notes: string | null
          deal_number: string | null
          door_count: number | null
          door_titles_count: number | null
          down_payment_notes: string | null
          dwelling_type: Database["public"]["Enums"]["dwelling_type"] | null
          expired_at: string | null
          first_and_heloc: boolean
          fixed_second: boolean
          foreign_income_country: string | null
          fthb: boolean
          gds: number | null
          general_notes: string | null
          guarantor: boolean
          heloc: boolean
          hobby_farm: boolean
          id: string
          income_notes: string | null
          insured: boolean
          lender_confirmed: boolean
          loan_amount: number | null
          location_type: Database["public"]["Enums"]["location_type"] | null
          ltv: number | null
          married_or_common_law: boolean
          medical_professional: boolean
          mortgage_position:
            | Database["public"]["Enums"]["mortgage_position"]
            | null
          mortgage_product:
            | Database["public"]["Enums"]["mortgage_product"]
            | null
          networth_program: boolean
          new_build: boolean
          new_to_canada: boolean
          no_lender_exceptions_required: boolean
          occupancy: Database["public"]["Enums"]["occupancy_type"] | null
          owns_other_properties: boolean
          prequal: boolean
          prequal_converted_at: string | null
          prequal_lender_notice_at: string | null
          previously_declined: boolean
          previously_declined_reason: string | null
          primary_credit_score: number | null
          property_value: number | null
          province: Database["public"]["Enums"]["province"] | null
          purchase_plus_improvements: boolean
          purpose: Database["public"]["Enums"]["transaction_purpose"] | null
          recreational_property: boolean
          reverse_mortgage: boolean
          septic: boolean
          spouse_not_on_application: boolean
          square_footage: number | null
          status: Database["public"]["Enums"]["deal_status"]
          submitted_at: string | null
          tds: number | null
          transaction_type:
            | Database["public"]["Enums"]["transaction_type"]
            | null
          transunion_being_used: boolean
          updated_at: string
          well_water: boolean
        }
        SetofOptions: {
          from: "*"
          to: "deals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_survey: {
        Args: {
          p_closed_with_lender: boolean
          p_commitment_on_time?: boolean
          p_doc_review_on_time?: boolean
          p_funded_on_time?: boolean
          p_not_closed_reason?: string
          p_satisfaction?: number
          p_survey_id: string
        }
        Returns: undefined
      }
      switch_offer: { Args: { p_deal_id: string }; Returns: undefined }
      update_invoice: {
        Args: {
          p_closing?: string
          p_invoice_id: string
          p_loan_amount?: number
          p_product?: Database["public"]["Enums"]["mortgage_product"]
        }
        Returns: {
          amount: number
          broker_name: string
          cancelled_at: string | null
          cancelled_reason: string | null
          client_name: string
          closing_date: string
          created_at: string
          deal_id: string
          document_name: string | null
          due_date: string
          id: string
          invoice_number: string
          lender_id: string
          loan_amount: number
          mortgage_product: Database["public"]["Enums"]["mortgage_product"]
          offer_id: string
          paid_at: string | null
          pdf_path: string | null
          platform_bps: number
          status: Database["public"]["Enums"]["invoice_status"]
          term_years: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      alert_detection: "regex" | "ai"
      alert_source:
        | "chat_message"
        | "offer_comments"
        | "deal_credit_notes"
        | "deal_income_notes"
        | "deal_down_payment_notes"
        | "deal_general_notes"
      credit_issue:
        | "lates_30_plus"
        | "lates_60_plus"
        | "lates_90_plus"
        | "mortgage_lates"
        | "closed_collections"
        | "open_collections"
        | "foreclosure"
        | "bankruptcy_closed_2y_plus"
        | "bankruptcy_closed_under_2y"
        | "active_bankruptcy"
        | "consumer_proposal_closed_2y_plus"
        | "consumer_proposal_closed_under_2y"
        | "active_consumer_proposal"
        | "repossession"
        | "judgement"
        | "garnishment"
        | "tax_lien"
      deal_status:
        | "draft"
        | "submitted"
        | "offer_received"
        | "accepted"
        | "confirmed"
        | "funded"
        | "expired"
        | "cancelled"
      down_payment_source:
        | "seasoned_funds_3m"
        | "fthb_rrsp_fhsa"
        | "gift_from_family"
        | "sale_of_existing_property"
        | "borrowed"
        | "foreign_funds"
        | "rent_to_own_credit"
      dwelling_type:
        | "detached"
        | "semi_detached"
        | "townhouse"
        | "condo_apartment"
        | "condo_townhouse"
        | "duplex"
        | "triplex"
        | "fourplex"
        | "mobile_home"
        | "modular_home"
        | "farm"
        | "recreational"
        | "duplex_detached"
        | "duplex_semi_detached"
        | "apartment_low_rise"
        | "apartment_high_rise"
      faq_category:
        | "getting_started"
        | "deals_and_offers"
        | "rates_and_fees"
        | "timelines_and_notifications"
        | "compliance_and_privacy"
        | "support_and_account"
      income_type:
        | "salary_no_ot"
        | "hourly_no_ot"
        | "salary_hourly_with_ot_2y_avg"
        | "casual_seasonal_2y_avg"
        | "commission"
        | "self_employed_full_doc"
        | "self_employed_stated"
        | "passive_income"
        | "passive_retired_income"
        | "ccb_under_15"
        | "rental_income"
        | "child_support_alimony"
        | "long_term_disability"
        | "short_term_disability"
        | "workers_comp"
        | "foreign_income"
      invoice_status: "pending" | "paid" | "cancelled"
      legal_doc_type: "privacy_policy" | "terms_and_conditions"
      location_type: "urban" | "rural"
      mortgage_position: "first" | "second" | "third"
      mortgage_product:
        | "5_year_fixed"
        | "5_year_arm_vrm"
        | "3_year_fixed"
        | "3_year_arm_vrm"
        | "4_year_fixed"
        | "2_year_fixed"
        | "1_year_fixed"
        | "6_month_convertible"
        | "open"
        | "7_year_fixed"
        | "10_year_fixed"
      notification_type:
        | "new_offer"
        | "offer_accepted"
        | "offer_switched"
        | "message_received"
        | "deal_expiring"
        | "deal_expired"
        | "filter_match"
        | "survey_pending"
        | "lender_approved"
        | "lender_rejected"
        | "auto_offer_sent"
        | "prequal_converted"
      occupancy_type:
        | "owner_occupied"
        | "rental_1_unit"
        | "rental_2_4_units"
        | "second_home"
      offer_decline_reason: "broker_rejected" | "auto_on_accept"
      offer_status: "pending" | "accepted" | "declined" | "switched"
      province:
        | "alberta"
        | "british_columbia"
        | "manitoba"
        | "new_brunswick"
        | "newfoundland_and_labrador"
        | "northwest_territories"
        | "nova_scotia"
        | "nunavut"
        | "ontario"
        | "prince_edward_island"
        | "quebec"
        | "saskatchewan"
        | "yukon"
      residency_status:
        | "canadian_citizen"
        | "permanent_resident"
        | "work_permit_cuaet"
        | "work_permit_non_cuaet"
      transaction_purpose: "purchase" | "refinance" | "renewal"
      transaction_type: "prime" | "alt" | "private"
      user_role: "broker" | "lender" | "admin"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      alert_detection: ["regex", "ai"],
      alert_source: [
        "chat_message",
        "offer_comments",
        "deal_credit_notes",
        "deal_income_notes",
        "deal_down_payment_notes",
        "deal_general_notes",
      ],
      credit_issue: [
        "lates_30_plus",
        "lates_60_plus",
        "lates_90_plus",
        "mortgage_lates",
        "closed_collections",
        "open_collections",
        "foreclosure",
        "bankruptcy_closed_2y_plus",
        "bankruptcy_closed_under_2y",
        "active_bankruptcy",
        "consumer_proposal_closed_2y_plus",
        "consumer_proposal_closed_under_2y",
        "active_consumer_proposal",
        "repossession",
        "judgement",
        "garnishment",
        "tax_lien",
      ],
      deal_status: [
        "draft",
        "submitted",
        "offer_received",
        "accepted",
        "confirmed",
        "funded",
        "expired",
        "cancelled",
      ],
      down_payment_source: [
        "seasoned_funds_3m",
        "fthb_rrsp_fhsa",
        "gift_from_family",
        "sale_of_existing_property",
        "borrowed",
        "foreign_funds",
        "rent_to_own_credit",
      ],
      dwelling_type: [
        "detached",
        "semi_detached",
        "townhouse",
        "condo_apartment",
        "condo_townhouse",
        "duplex",
        "triplex",
        "fourplex",
        "mobile_home",
        "modular_home",
        "farm",
        "recreational",
        "duplex_detached",
        "duplex_semi_detached",
        "apartment_low_rise",
        "apartment_high_rise",
      ],
      faq_category: [
        "getting_started",
        "deals_and_offers",
        "rates_and_fees",
        "timelines_and_notifications",
        "compliance_and_privacy",
        "support_and_account",
      ],
      income_type: [
        "salary_no_ot",
        "hourly_no_ot",
        "salary_hourly_with_ot_2y_avg",
        "casual_seasonal_2y_avg",
        "commission",
        "self_employed_full_doc",
        "self_employed_stated",
        "passive_income",
        "passive_retired_income",
        "ccb_under_15",
        "rental_income",
        "child_support_alimony",
        "long_term_disability",
        "short_term_disability",
        "workers_comp",
        "foreign_income",
      ],
      invoice_status: ["pending", "paid", "cancelled"],
      legal_doc_type: ["privacy_policy", "terms_and_conditions"],
      location_type: ["urban", "rural"],
      mortgage_position: ["first", "second", "third"],
      mortgage_product: [
        "5_year_fixed",
        "5_year_arm_vrm",
        "3_year_fixed",
        "3_year_arm_vrm",
        "4_year_fixed",
        "2_year_fixed",
        "1_year_fixed",
        "6_month_convertible",
        "open",
        "7_year_fixed",
        "10_year_fixed",
      ],
      notification_type: [
        "new_offer",
        "offer_accepted",
        "offer_switched",
        "message_received",
        "deal_expiring",
        "deal_expired",
        "filter_match",
        "survey_pending",
        "lender_approved",
        "lender_rejected",
        "auto_offer_sent",
        "prequal_converted",
      ],
      occupancy_type: [
        "owner_occupied",
        "rental_1_unit",
        "rental_2_4_units",
        "second_home",
      ],
      offer_decline_reason: ["broker_rejected", "auto_on_accept"],
      offer_status: ["pending", "accepted", "declined", "switched"],
      province: [
        "alberta",
        "british_columbia",
        "manitoba",
        "new_brunswick",
        "newfoundland_and_labrador",
        "northwest_territories",
        "nova_scotia",
        "nunavut",
        "ontario",
        "prince_edward_island",
        "quebec",
        "saskatchewan",
        "yukon",
      ],
      residency_status: [
        "canadian_citizen",
        "permanent_resident",
        "work_permit_cuaet",
        "work_permit_non_cuaet",
      ],
      transaction_purpose: ["purchase", "refinance", "renewal"],
      transaction_type: ["prime", "alt", "private"],
      user_role: ["broker", "lender", "admin"],
    },
  },
} as const

