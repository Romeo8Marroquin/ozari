-- Eliminar el esquema público y sus objetos, luego recrearlo
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

-- Tabla: user_roles
CREATE TABLE user_roles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Tabla: users
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  full_name_kms TEXT NOT NULL,
  email_sha VARCHAR(256) UNIQUE NOT NULL,
  email_kms TEXT NOT NULL,
  role_id INT NOT NULL,
  password_sha VARCHAR(256) NOT NULL,
  password_kms TEXT NOT NULL,
  terms_accepted BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES user_roles(id)
);

-- Tabla: blacklist_types
CREATE TABLE blacklist_types (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Tabla: blacklist
CREATE TABLE blacklist (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  blacklist_type_id INT NOT NULL,
  reason TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT fk_blacklist_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_blacklist_types FOREIGN KEY (blacklist_types_id) REFERENCES blacklist_types(id)
);

-- Tabla: user_phone_types
CREATE TABLE user_phone_types (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Tabla: user_phones
CREATE TABLE user_phones (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  user_phone_type_id INT NOT NULL,
  phone_number_kms TEXT NOT NULL,
  is_principal BOOLEAN NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT fk_user_phones_type FOREIGN KEY (user_phone_type_id) REFERENCES user_phone_types(id),
  CONSTRAINT fk_user_phones_user FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Tabla: currencies
CREATE TABLE currencies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  symbol VARCHAR(1) NOT NULL,
  iso_4217_code VARCHAR(3) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Tabla: product_business_type
CREATE TABLE product_business_type (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Tabla: product_category
CREATE TABLE product_category (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Tabla: products
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  product_business_type_id INT NOT NULL,
  product_category_id INT NOT NULL,
  rentPrice NUMERIC(15,2),
  sellPrice NUMERIC(15,2),
  currency_id INT NOT NULL,
  quantity INT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT fk_products_business_type FOREIGN KEY (product_business_type_id) REFERENCES product_business_type(id),
  CONSTRAINT fk_products_category FOREIGN KEY (product_category_id) REFERENCES product_category(id),
  CONSTRAINT fk_products_currency FOREIGN KEY (currency_id) REFERENCES currencies(id)
);

-- Tabla: product_detail_types
CREATE TABLE product_detail_types (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Tabla: product_details
CREATE TABLE product_details (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL,
  product_detail_type_id INT NOT NULL,
  detail TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT fk_product_details_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_product_details_type FOREIGN KEY (product_detail_type_id) REFERENCES product_detail_types(id)
);

-- Tabla: countries
CREATE TABLE countries (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Tabla: departments
CREATE TABLE departments (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  country_id INT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT fk_departments_country FOREIGN KEY (country_id) REFERENCES countries(id)
);

-- Tabla: municipalities
CREATE TABLE municipalities (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  department_id INT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT fk_municipalities_department FOREIGN KEY (department_id) REFERENCES departments(id)
);

-- Tabla: zones
CREATE TABLE zones (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  municipality_id INT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT fk_zones_municipality FOREIGN KEY (municipality_id) REFERENCES municipalities(id)
);

-- Tabla: addresses
CREATE TABLE addresses (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  zone_id INT NOT NULL,
  address_kms TEXT NOT NULL,
  coords_kms TEXT,
  instructions_kms TEXT,
  domicile_price NUMERIC(15,2),
  delivery_time_minutes INT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT fk_addresses_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_addresses_zone FOREIGN KEY (zone_id) REFERENCES zones(id)
);

-- Tabla: service_status
CREATE TABLE service_status (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Tabla: payment_status
CREATE TABLE payment_status (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Tabla: services
CREATE TABLE services (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  delivery_name_kms TEXT NOT NULL,
  address_id INT NOT NULL,
  user_phone_id INT NOT NULL,
  description TEXT,
  service_start TIMESTAMP NOT NULL,
  service_end TIMESTAMP NOT NULL,
  total_amount NUMERIC(15,2) NOT NULL,
  currency_id INT NOT NULL,
  service_status_id INT NOT NULL,
  payment_status_id INT NOT NULL,
  comment TEXT,
  invoice_number_kms TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT fk_services_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_services_address FOREIGN KEY (address_id) REFERENCES addresses(id),
  CONSTRAINT fk_services_user_phone FOREIGN KEY (user_phone_id) REFERENCES user_phones(id),
  CONSTRAINT fk_services_currency FOREIGN KEY (currency_id) REFERENCES currencies(id),
  CONSTRAINT fk_services_service_status FOREIGN KEY (service_status_id) REFERENCES service_status(id),
  CONSTRAINT fk_services_payment_status FOREIGN KEY (payment_status_id) REFERENCES payment_status(id)
);

-- Tabla: service_details
CREATE TABLE service_details (
  id SERIAL PRIMARY KEY,
  service_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL,
  unitary_price NUMERIC(15,2) NOT NULL,
  parcial_price NUMERIC(15,2) NOT NULL,
  currency_id INT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT fk_service_details_service FOREIGN KEY (service_id) REFERENCES services(id),
  CONSTRAINT fk_service_details_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_service_details_currency FOREIGN KEY (currency_id) REFERENCES currencies(id)
);

-- Tabla: service_extras
CREATE TABLE service_extras (
  id SERIAL PRIMARY KEY,
  service_id INT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  quantity INT,
  unitary_price NUMERIC(15,2),
  parcial_price NUMERIC(15,2),
  currency_id INT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT fk_service_extras_service FOREIGN KEY (service_id) REFERENCES services(id),
  CONSTRAINT fk_service_extras_currency FOREIGN KEY (currency_id) REFERENCES currencies(id)
);
