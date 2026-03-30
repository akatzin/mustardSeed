-- ==============================================================================
-- 🛡️ RESISTENCIA CYBORG - DEFENSA ALTA DE BASE DE DATOS E IP TRACKING
-- ==============================================================================
-- OJO: Copia y ejecuta todo este bloque en tu editor SQL de Supabase (SQL Editor).
-- ESTO NO BORRARÁ TUS DATOS EXISTENTES. Sólo añadirá capas de seguridad.

-- 1. Activamos la extensión criptográfica genérica por si la necesitamos
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Añadimos la columna 'ip_hash' a las firmas.
-- ¿Por qué 'ip_hash' y no la IP real? Porque tu tabla 'signatures' es de LECTURA PÚBLICA (RLS SELECT *).
-- Si guardáramos la IP raw en esa tabla, un hacker podría descargar IPs de usuarios inocentes.
-- El Hash (ej. 'e3b0c4429...') nos permitirá AGRUPAR y BORRAR basura de golpe sin comprometer privacidad global.
ALTER TABLE signatures ADD COLUMN IF NOT EXISTS ip_hash TEXT;

-- 3. Creamos una tabla privada de 'rate_limits' para bloquear IPs y ver a los spammers
-- Esta tabla NO tiene políticas públicas RLS, es totalmente privada para ti (Administrador).
-- Aquí SÍ guardaremos la IP en texto plano para que puedas investigarla desde tu Dashboard.
CREATE TABLE IF NOT EXISTS rate_limits (
  ip_address TEXT PRIMARY KEY,
  last_request_time TIMESTAMPTZ DEFAULT NOW(),
  request_count INT DEFAULT 1
);

-- ==============================================================================
-- ¡VITAL!: ACTIVAMOS RLS SIN POLÍTICAS PARA BLOQUEAR ACCESO PÚBLICO
-- ==============================================================================
-- Al habilitar RLS y no escribir ninguna política "Allow", Postgres bloquea el 100% 
-- de los intentos de lectura y escritura desde el frontend (llave anon).
-- Esto asegura que ningún atacante pueda descargar la lista de IPs.
-- Nuestro 'trigger' funciona porque usa SECURITY DEFINER (saltándose el RLS).
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- 4. Creamos la función súper-defensora (SECURITY DEFINER permite que salte reglas RLS internamente)
CREATE OR REPLACE FUNCTION process_signature_security()
RETURNS trigger SECURITY DEFINER AS $$
DECLARE
  client_ip TEXT;
  recent_count INT;
BEGIN
  -- PostgREST de Supabase intercepta la IP real del usuario en los headers
  client_ip := current_setting('request.headers', true)::json->>'x-forwarded-for';
  client_ip := split_part(client_ip, ',', 1);

  IF client_ip IS NOT NULL AND client_ip != '' THEN
    
    -- FUNCION A: Asignamos el hash irreversible públicamente a la firma. 
    -- Si un bot spamea, 1000 firmas tendrán el mismo ip_hash y podrás borrar todas con 1 click.
    NEW.ip_hash := encode(digest(client_ip, 'sha256'), 'hex');

    -- FUNCION B: Rate Limiting y Tracking Secreto Interno (IP Real)
    INSERT INTO rate_limits (ip_address, last_request_time, request_count)
    VALUES (client_ip, NOW(), 1)
    ON CONFLICT (ip_address) 
    DO UPDATE SET 
      request_count = CASE 
        -- Ventana estricta: 10 minutos
        WHEN NOW() - rate_limits.last_request_time < INTERVAL '10 minutes' THEN rate_limits.request_count + 1
        ELSE 1 
      END,
      last_request_time = NOW()
    RETURNING request_count INTO recent_count;

    -- FUNCION C: El Martillo (Límite = 3 firmas por 10 minutos)
    IF recent_count > 3 THEN
      RAISE EXCEPTION 'Ataque DDoS detectado: Límite estricto de 3 firmas superado por este Nodo.';
    END IF;

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Enganchamos esta función a CADA INSERCIÓN nueva en las firmas.
DROP TRIGGER IF EXISTS trigger_signature_security ON signatures;
CREATE TRIGGER trigger_signature_security
BEFORE INSERT ON signatures
FOR EACH ROW
EXECUTE FUNCTION process_signature_security();

-- ¡LISTO! AHORA TU BACKEND RECHAZARÁ CUALQUIER INTENTO BURDO DE SPAM DESDE RAÍZ.
