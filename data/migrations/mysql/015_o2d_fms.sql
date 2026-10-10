-- ══════════════════════════════════════════════════════
-- ORDER-TO-DISPATCH FMS (Spec v1.0) — DB-native module. Google Sheet wala
-- purana O2D flow parallel chalta rehta hai; ye naye orders ke liye hai.
-- Saare datetime columns IST wall-clock 'YYYY-MM-DD HH:MM:SS' string
-- (varchar(19)) hain — app JS se likhti hai, taaki Postgres aur MySQL dono
-- par timezone shift ka koi jhanjhat na rahe. Dates asli DATE hain.
-- ══════════════════════════════════════════════════════

-- ── Masters ──────────────────────────────────────────
CREATE TABLE fms_customers (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  client_name varchar(200) NOT NULL,
  company_name varchar(200), contact_number varchar(20), alt_contact_number varchar(20),
  email varchar(150), address text, city varchar(100), state varchar(100), pin_code varchar(10),
  gst_number varchar(20),
  labour_rate decimal(12,2) DEFAULT 0, labour_rate_basis varchar(20) DEFAULT 'Per Gram',
  gold_tunch_pct decimal(6,2) DEFAULT 0,
  certificate_required smallint DEFAULT 0, default_lab_id int, quality_id int,
  payment_terms_days int DEFAULT 30, payment_style varchar(20) DEFAULT 'Invoice-wise',
  whatsapp_group_name varchar(200), sales_person_id int, is_active smallint DEFAULT 1,
  created_at varchar(19), created_by int, updated_at varchar(19), updated_by int, is_deleted smallint DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE fms_vendors (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  vendor_name varchar(200) NOT NULL, vendor_type varchar(30) NOT NULL,
  contact_person varchar(100), contact_number varchar(20),
  address text, city varchar(100), state varchar(100), pin_code varchar(10), gst_number varchar(20),
  default_lead_time_days int DEFAULT 7, is_active smallint DEFAULT 1,
  created_at varchar(19), created_by int, updated_at varchar(19), updated_by int, is_deleted smallint DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE fms_quality_master (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY, name varchar(100) NOT NULL, is_active smallint DEFAULT 1,
  created_at varchar(19), created_by int, updated_at varchar(19), updated_by int, is_deleted smallint DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE fms_lab_master (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY, name varchar(100) NOT NULL, is_active smallint DEFAULT 1,
  created_at varchar(19), created_by int, updated_at varchar(19), updated_by int, is_deleted smallint DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE fms_reason_master (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY, name varchar(100) NOT NULL, is_active smallint DEFAULT 1,
  created_at varchar(19), created_by int, updated_at varchar(19), updated_by int, is_deleted smallint DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE fms_followup_outcome (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY, name varchar(100) NOT NULL, task_type varchar(40), is_active smallint DEFAULT 1,
  created_at varchar(19), created_by int, updated_at varchar(19), updated_by int, is_deleted smallint DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE fms_stage_target (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY, stage_key varchar(30) NOT NULL UNIQUE, stage_name varchar(100) NOT NULL,
  target_days int DEFAULT 0, default_assignee_id int, sort_order int DEFAULT 0,
  created_at varchar(19), created_by int, updated_at varchar(19), updated_by int, is_deleted smallint DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE fms_sequence (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY, doc_type varchar(20) NOT NULL, yymm varchar(10) NOT NULL, last_no int DEFAULT 0,
  UNIQUE (doc_type, yymm)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Orders ───────────────────────────────────────────
CREATE TABLE fms_orders (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  unique_id varchar(30) NOT NULL UNIQUE, order_no varchar(50),
  client_id int, sales_person_id int, owner_id int,
  order_type varchar(20), style_no varchar(100), development_type varchar(30),
  qty_pcs int DEFAULT 0, additional_reduction_pcs int DEFAULT 0,
  diamond_carat_weight decimal(12,3) DEFAULT 0, quality_id int, lab_id int, certificate_required smallint DEFAULT 0,
  lead_time_days int DEFAULT 0, delivery_date date, remark text,
  order_status varchar(40), current_stage varchar(30), stage_entered_at varchar(19),
  cad_status varchar(30), confirmation_status varchar(20),
  quotation_posted_on varchar(19), quotation_amount decimal(14,2), quotation_remark text,
  confirmed_on date, confirmation_reason text,
  handed_over_on varchar(19), handed_over_to int,
  bagging_query smallint DEFAULT 0, bagging_query_remark text,
  hallmark_status varchar(20), cert_status varchar(20),
  hold_from_stage varchar(30), cancel_reason text, submitted_on varchar(19), closed_on varchar(19),
  created_at varchar(19), created_by int, updated_at varchar(19), updated_by int, is_deleted smallint DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX fms_orders_idx_client ON fms_orders(client_id);
CREATE INDEX fms_orders_idx_status ON fms_orders(order_status);
CREATE INDEX fms_orders_idx_stage ON fms_orders(current_stage);
CREATE INDEX fms_orders_idx_delivery ON fms_orders(delivery_date);

CREATE TABLE fms_order_diamond_lines (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY, order_id int NOT NULL, shape varchar(50), sieve_size varchar(50), pcs int DEFAULT 0, carat decimal(12,3) DEFAULT 0,
  created_at varchar(19), created_by int, updated_at varchar(19), updated_by int, is_deleted smallint DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX fms_odl_idx_order ON fms_order_diamond_lines(order_id);

CREATE TABLE fms_order_files (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY, order_id int, file_type varchar(30), ref_table varchar(40), ref_id int,
  file_name varchar(255), mime varchar(100), size_bytes int, data LONGTEXT,
  created_at varchar(19), created_by int, updated_at varchar(19), updated_by int, is_deleted smallint DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX fms_files_idx_order ON fms_order_files(order_id);
CREATE INDEX fms_files_idx_ref ON fms_order_files(ref_table, ref_id);

CREATE TABLE fms_order_status_log (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY, order_id int NOT NULL, from_status varchar(40), to_status varchar(40),
  from_stage varchar(30), to_stage varchar(30), changed_by int, changed_at varchar(19), remark text
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX fms_osl_idx_order ON fms_order_status_log(order_id);

CREATE TABLE fms_order_change_log (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY, order_id int NOT NULL, field_name varchar(60), old_value text, new_value text,
  reason text, changed_by int, changed_at varchar(19)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX fms_ocl_idx_order ON fms_order_change_log(order_id);

-- ── CAD ──────────────────────────────────────────────
CREATE TABLE fms_cad (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY, order_id int NOT NULL, revision_no int DEFAULT 1, cad_vendor_id int,
  requested_on date, expected_on date, brief text, cad_status varchar(30),
  received_on date, sent_on date, sent_channel varchar(30), sent_note text,
  approver_type varchar(20), approved_on date, decision_reason text,
  created_at varchar(19), created_by int, updated_at varchar(19), updated_by int, is_deleted smallint DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX fms_cad_idx_order ON fms_cad(order_id);

-- ── Bagging ──────────────────────────────────────────
CREATE TABLE fms_bagging (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY, order_id int NOT NULL, doer_id int,
  details_verified smallint DEFAULT 0, verified_on varchar(19), verified_by int, verification_remark text,
  order_qty int DEFAULT 0, total_bagged int DEFAULT 0, total_rejected int DEFAULT 0, pending_pcs int DEFAULT 0,
  bagging_status varchar(40), completed_on varchar(19),
  created_at varchar(19), created_by int, updated_at varchar(19), updated_by int, is_deleted smallint DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX fms_bag_idx_order ON fms_bagging(order_id);
CREATE TABLE fms_bagging_entry (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY, bagging_id int NOT NULL, entry_date date, bagged_pcs int DEFAULT 0, rejected_pcs int DEFAULT 0,
  rejection_reason text, bagged_carat decimal(12,3), remark text, linked_receipt_id int,
  created_at varchar(19), created_by int, updated_at varchar(19), updated_by int, is_deleted smallint DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX fms_bage_idx_bag ON fms_bagging_entry(bagging_id);
CREATE TABLE fms_requirement (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY, requirement_no varchar(30), order_id int NOT NULL, bagging_id int, vendor_id int,
  required_pcs int DEFAULT 0, required_carat decimal(12,3), shape varchar(50), size varchar(50), quality varchar(50),
  required_by_date date, remark text, requirement_status varchar(30),
  received_pcs int DEFAULT 0, received_carat decimal(12,3) DEFAULT 0, pending_pcs int DEFAULT 0,
  created_at varchar(19), created_by int, updated_at varchar(19), updated_by int, is_deleted smallint DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX fms_req_idx_order ON fms_requirement(order_id);
CREATE TABLE fms_requirement_receipt (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY, requirement_id int NOT NULL, receipt_date date, received_pcs int DEFAULT 0,
  received_carat decimal(12,3), vendor_invoice_no varchar(50), vendor_invoice_date date, remark text,
  created_at varchar(19), created_by int, updated_at varchar(19), updated_by int, is_deleted smallint DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX fms_reqr_idx_req ON fms_requirement_receipt(requirement_id);

-- ── Vendor (finished goods) ──────────────────────────
CREATE TABLE fms_vendor_issue (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY, issue_no varchar(30), customer_id int, vendor_id int, issue_date date,
  issue_invoice_no varchar(50), total_pcs int DEFAULT 0, total_weight decimal(14,3) DEFAULT 0,
  remark text, expected_return_date date,
  created_at varchar(19), created_by int, updated_at varchar(19), updated_by int, is_deleted smallint DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE fms_vendor_issue_line (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY, issue_id int NOT NULL, order_id int NOT NULL, issued_pcs int DEFAULT 0,
  issued_weight_gm decimal(14,3) DEFAULT 0, issued_carat decimal(12,3),
  received_pcs int DEFAULT 0, received_weight decimal(14,3) DEFAULT 0, line_status varchar(30),
  created_at varchar(19), created_by int, updated_at varchar(19), updated_by int, is_deleted smallint DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX fms_vil_idx_issue ON fms_vendor_issue_line(issue_id);
CREATE INDEX fms_vil_idx_order ON fms_vendor_issue_line(order_id);
CREATE TABLE fms_vendor_receipt (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY, receipt_no varchar(30), vendor_id int, receipt_date date,
  vendor_invoice_no varchar(50), vendor_invoice_date date, remark text,
  created_at varchar(19), created_by int, updated_at varchar(19), updated_by int, is_deleted smallint DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE fms_vendor_receipt_line (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY, receipt_id int NOT NULL, issue_line_id int NOT NULL, order_id int,
  received_pcs int DEFAULT 0, received_weight_gm decimal(14,3) DEFAULT 0, wastage_weight_gm decimal(14,3) DEFAULT 0,
  calc_wastage_gm decimal(14,3), wastage_pct decimal(8,3), hallmark_done smallint DEFAULT 0, remark text,
  created_at varchar(19), created_by int, updated_at varchar(19), updated_by int, is_deleted smallint DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX fms_vrl_idx_line ON fms_vendor_receipt_line(issue_line_id);
CREATE INDEX fms_vrl_idx_order ON fms_vendor_receipt_line(order_id);

-- ── Hallmark & Lab ───────────────────────────────────
CREATE TABLE fms_hallmark (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY, order_id int NOT NULL, pcs_sent int DEFAULT 0, sent_on date, hallmark_centre_id int,
  expected_on date, status varchar(20), received_on date, pcs_received int, huid_numbers text, remark text,
  created_at varchar(19), created_by int, updated_at varchar(19), updated_by int, is_deleted smallint DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX fms_hm_idx_order ON fms_hallmark(order_id);
CREATE TABLE fms_lab_certificate (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY, order_id int NOT NULL, lab_id int, pcs_sent int DEFAULT 0, sent_on date,
  lab_challan_no varchar(50), expected_on date, status varchar(30), received_on date, pcs_received int,
  certificate_numbers text, remark text,
  created_at varchar(19), created_by int, updated_at varchar(19), updated_by int, is_deleted smallint DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX fms_lab_idx_order ON fms_lab_certificate(order_id);

-- ── Dispatch & Payments ──────────────────────────────
CREATE TABLE fms_dispatch (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY, dispatch_no varchar(30), customer_id int, invoice_no varchar(60), invoice_date date,
  invoice_amount decimal(14,2) DEFAULT 0, gold_amount decimal(14,2) DEFAULT 0, diamond_amount decimal(14,2) DEFAULT 0,
  labour_amount decimal(14,2) DEFAULT 0, other_amount decimal(14,2) DEFAULT 0,
  dispatch_date date, courier varchar(100), awb_no varchar(100), dispatched_via varchar(100),
  payment_due_date date, received_amount decimal(14,2) DEFAULT 0, balance decimal(14,2) DEFAULT 0,
  payment_status varchar(20), remark text,
  created_at varchar(19), created_by int, updated_at varchar(19), updated_by int, is_deleted smallint DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX fms_dsp_idx_cust ON fms_dispatch(customer_id);
CREATE TABLE fms_dispatch_line (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY, dispatch_id int NOT NULL, order_id int NOT NULL, pcs int DEFAULT 0,
  weight_gm decimal(14,3), line_amount decimal(14,2),
  created_at varchar(19), created_by int, updated_at varchar(19), updated_by int, is_deleted smallint DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX fms_dspl_idx_dsp ON fms_dispatch_line(dispatch_id);
CREATE INDEX fms_dspl_idx_order ON fms_dispatch_line(order_id);
CREATE TABLE fms_payment_receipt (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY, receipt_no varchar(30), customer_id int, receipt_date date,
  amount_received decimal(14,2) DEFAULT 0, payment_mode varchar(20), reference_no varchar(100),
  receipt_mode varchar(20), on_account_amount decimal(14,2) DEFAULT 0, remark text,
  created_at varchar(19), created_by int, updated_at varchar(19), updated_by int, is_deleted smallint DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE fms_payment_allocation (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY, receipt_id int NOT NULL, dispatch_id int NOT NULL, allocated_amount decimal(14,2) DEFAULT 0,
  created_at varchar(19), created_by int, updated_at varchar(19), updated_by int, is_deleted smallint DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX fms_pa_idx_dsp ON fms_payment_allocation(dispatch_id);
CREATE TABLE fms_payment_category_allocation (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY, receipt_id int NOT NULL, dispatch_id int NOT NULL, category varchar(20),
  allocated_amount decimal(14,2) DEFAULT 0,
  created_at varchar(19), created_by int, updated_at varchar(19), updated_by int, is_deleted smallint DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX fms_pca_idx_dsp ON fms_payment_category_allocation(dispatch_id);

-- ── Follow-up engine ─────────────────────────────────
CREATE TABLE fms_followup_task (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY, task_type varchar(40) NOT NULL, order_id int, ref_table varchar(40), ref_id int,
  party_type varchar(20), party_id int, assigned_to int, title varchar(255),
  opened_on varchar(19), next_followup_date date, last_followup_on varchar(19), followup_count int DEFAULT 0,
  status varchar(10) DEFAULT 'Open', closed_on varchar(19), closed_reason text,
  created_at varchar(19), created_by int, updated_at varchar(19), updated_by int, is_deleted smallint DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX fms_fut_idx_status ON fms_followup_task(status, next_followup_date);
CREATE INDEX fms_fut_idx_order ON fms_followup_task(order_id);
CREATE INDEX fms_fut_idx_ref ON fms_followup_task(ref_table, ref_id);
CREATE TABLE fms_followup_log (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY, task_id int NOT NULL, followup_date varchar(19), mode varchar(20), spoke_to varchar(100),
  outcome varchar(100), remark text, next_followup_date date, promised_date date, promised_amount decimal(14,2),
  created_at varchar(19), created_by int, updated_at varchar(19), updated_by int, is_deleted smallint DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX fms_ful_idx_task ON fms_followup_log(task_id);

-- ── Seed lookups ─────────────────────────────────────
INSERT INTO fms_quality_master (name) VALUES ('VVS-EF'),('VVS-GH'),('VS-GH'),('VS-SI GH'),('SI-GH'),('SI-IJ');
INSERT INTO fms_lab_master (name) VALUES ('IGI'),('GIA'),('SGL'),('GSI'),('HRD'),('Other');
INSERT INTO fms_reason_master (name) VALUES ('Price'),('Design'),('Delay'),('Quality'),('Client Dropped'),('Other');
INSERT INTO fms_followup_outcome (name) VALUES ('No Response'),('Will Share Tomorrow'),('Promised'),('Call Back Later'),('Other');
INSERT INTO fms_stage_target (stage_key, stage_name, target_days, sort_order) VALUES
  ('ORDER','Order Entry',1,1),('CAD','CAD Development',7,2),('APPROVAL','CAD Client Approval',3,3),
  ('CONFIRMATION','Quotation & Confirmation',3,4),('ORDER_SHEET','Order Sheet to Production',1,5),
  ('BAGGING','Bagging',3,6),('VENDOR','At Vendor (FG)',15,7),('HALLMARK','Hallmarking',2,8),
  ('LAB','Lab Certification',5,9),('DISPATCH','Ready for Dispatch',1,10),('PAYMENT','Payment Follow-up',30,11);
