CREATE UNIQUE INDEX IF NOT EXISTS seasonal_month_category_unique ON seasonal_pricing_matrix(month, category);
ALTER TABLE booking_logs ADD CONSTRAINT booking_vehicle_fk FOREIGN KEY (vehicle_id) REFERENCES fleet_catalog(id);
ALTER TABLE booking_logs ADD CONSTRAINT booking_customer_fk FOREIGN KEY (customer_id) REFERENCES customer_profiles(id);
ALTER TABLE booking_logs ADD CONSTRAINT booking_dates_valid CHECK (end_date > start_date AND days > 0);
ALTER TABLE fleet_catalog ADD CONSTRAINT fleet_values_valid CHECK (vehicles_available >= 0 AND base_daily_rate >= 0);
ALTER TABLE seasonal_pricing_matrix ADD CONSTRAINT seasonal_values_valid CHECK (month BETWEEN 1 AND 12 AND multiplier > 0);
CREATE UNIQUE INDEX IF NOT EXISTS policies_source_content_unique ON rental_policies_vectors(source, content);
