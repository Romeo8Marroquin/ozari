-- Eliminar el esquema público y sus objetos, luego recrearlo
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

-- Tabla: currencies
CREATE TABLE currencies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  symbol VARCHAR(3) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Tabla: products
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  type INTEGER,
  rentPrice NUMERIC(15,2),
  sellPrice NUMERIC(15,2),
  currency_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMP,
  updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT fk_product_currency FOREIGN KEY (currency_id) REFERENCES currencies(id)
);

-- Tabla: users
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  full_name_kms TEXT,
  email_sha VARCHAR(256) UNIQUE,
  email_kms TEXT,
  phone VARCHAR(10),
  role INTEGER NOT NULL,
  password_sha VARCHAR(256) NOT NULL,
  password_kms TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMP,
  updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Tabla: countries
CREATE TABLE countries (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Tabla: departments
CREATE TABLE departments (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Tabla: municipalities
CREATE TABLE municipalities (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Tabla: zones
CREATE TABLE zones (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Tabla: addresses (incluye referencias a countries, departments, municipalities y zones)
CREATE TABLE addresses (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  address_line TEXT NOT NULL,
  municipality INTEGER,
  department INTEGER,
  country INTEGER,
  zone INTEGER,
  postal_code VARCHAR(10),
  updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT fk_address_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_address_municipality FOREIGN KEY (municipality) REFERENCES municipalities(id),
  CONSTRAINT fk_address_department FOREIGN KEY (department) REFERENCES departments(id),
  CONSTRAINT fk_address_country FOREIGN KEY (country) REFERENCES countries(id),
  CONSTRAINT fk_address_zone FOREIGN KEY (zone) REFERENCES zones(id)
);

-- Tabla: inventory_logs
CREATE TABLE inventory_logs (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL,
  type INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  note TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT fk_invlog_product FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Tabla: rentals
CREATE TABLE rentals (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  rented_from DATE NOT NULL,
  rented_to DATE NOT NULL,
  unitary_price NUMERIC(15,2) NOT NULL,
  total_price NUMERIC(15,2) NOT NULL,
  currency_id INTEGER NOT NULL,
  status INTEGER NOT NULL,
  returned_at TIMESTAMP,
  comment TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMP,
  updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT fk_rent_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_rent_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_rent_currency FOREIGN KEY (currency_id) REFERENCES currencies(id)
);

-- Tabla: sales
CREATE TABLE sales (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  unitary_price NUMERIC(15,2) NOT NULL,
  total_price NUMERIC(15,2) NOT NULL,
  currency_id INTEGER NOT NULL,
  status INTEGER NOT NULL,
  comment TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMP,
  updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT fk_sale_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_sale_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_sale_currency FOREIGN KEY (currency_id) REFERENCES currencies(id)
);

-- INSERT: País, Departamento, Municipio y Zonas

-- Insertar país: Guatemala
INSERT INTO countries (name, description)
VALUES ('Guatemala', 'País con cobertura');

-- Insertar departamento: Guatemala
INSERT INTO departments (name, description)
VALUES ('Guatemala', 'Departamento con cobertura');

-- Insertar municipio: Ciudad de Guatemala
INSERT INTO municipalities (name, description)
VALUES ('Ciudad de Guatemala', 'Municipio con cobertura');

-- Insertar zonas
INSERT INTO zones (name, description)
VALUES 
  ('Zona 1', 'Zona con cobertura'),
  ('Zona 4', 'Zona con cobertura'),
  ('Zona 5', 'Zona con cobertura'),
  ('Zona 8', 'Zona con cobertura'),
  ('Zona 9', 'Zona con cobertura'),
  ('Zona 10', 'Zona con cobertura'),
  ('Zona 14', 'Zona con cobertura'),
  ('Zona 15', 'Zona con cobertura'),
  ('Zona 16', 'Zona con cobertura');