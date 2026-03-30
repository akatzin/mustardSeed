// Estado Global
let currentLang = 'es';
let dictionary = {};

// Instanciar Supabase preventivamente
let supabaseClient = null;
try {
    if (typeof CONFIG !== 'undefined' && CONFIG.SUPABASE_URL && CONFIG.SUPABASE_PUBLISHABLE_KEY) {
        supabaseClient = window.supabase.createClient(
            CONFIG.SUPABASE_URL,
            CONFIG.SUPABASE_PUBLISHABLE_KEY
        );
    }
} catch (e) {
    console.warn('Error instanciando Supabase (revisa config.js):', e);
}

console.log("app.js script execution started");

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

async function initApp() {
    console.log("initApp ejecutado");
    await initI18n();
    await loadSignatures();
    setupCaptcha();
    setupForm();
    setupRealtime();
}

// Inicialización de Internacionalización
async function initI18n() {
    try {
        const res = await fetch('locales/languages.json');
        const languages = await res.json();
        const select = document.getElementById('lang-select');

        languages.forEach(lang => {
            const option = document.createElement('option');
            option.value = lang.code;
            option.textContent = lang.name;
            select.appendChild(option);
        });

        // Intentar obtener el idioma guardado o el del navegador
        const savedLang = localStorage.getItem('i18n_lang');
        const browserLang = navigator.language.split('-')[0];

        if (savedLang && languages.find(l => l.code === savedLang)) {
            currentLang = savedLang;
        } else if (languages.find(l => l.code === browserLang)) {
            currentLang = browserLang;
        }

        select.value = currentLang;
        select.addEventListener('change', (e) => {
            setLanguage(e.target.value);
        });

        await setLanguage(currentLang);
    } catch (e) {
        console.error('Error cargando configuración de idiomas:', e);
    }
}

async function setLanguage(lang) {
    try {
        const res = await fetch(`locales/${lang}.json`);
        dictionary = await res.json();
        currentLang = lang;
        localStorage.setItem('i18n_lang', lang);
        document.documentElement.lang = lang;

        // Actualizar el link de descarga según el idioma detectado/seleccionado
        const dlLink = document.getElementById('download-link');
        dlLink.href = `downloads/${lang}/AI_Manifesto_${lang}.pdf`;

        updateDOMTexts();
    } catch (e) {
        console.error(`Error cargando el archivo de idioma ${lang}.json`, e);
    }
}

function updateDOMTexts() {
    document.title = dictionary['title'] || 'Document';

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (dictionary[key]) {
            el.textContent = dictionary[key];
        }
    });

    document.querySelectorAll('[data-i18n-html]').forEach(el => {
        const key = el.getAttribute('data-i18n-html');
        if (dictionary[key]) {
            el.innerHTML = dictionary[key];
        }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (dictionary[key]) {
            el.setAttribute('placeholder', dictionary[key]);
        }
    });
}

// Inicialización de Firmas
async function loadSignatures() {
    try {
        if (!supabaseClient || !CONFIG.SUPABASE_URL) {
            console.warn("Faltan credenciales de Supabase en config.js o son inválidas");
            // Podemos renderizar lista vacía para que no se quede cargando en el aire
            renderSignatures([]);
            updateCounter(0);
            return;
        }

        // Obtener datos y total en la misma consulta
        const { data: signatures, count, error } = await supabaseClient
            .from('signatures')
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false })
            .limit(4);

        if (error) throw error;

        updateCounter(count);
        renderSignatures(signatures || []);
    } catch (e) {
        console.error('Error cargando firmas distribuidas:', e);
    }
}

function updateCounter(count) {
    const counterEl = document.getElementById('signature-count');
    if (counterEl) {
        counterEl.textContent = `${count} ${dictionary['signatures_count_label'] || 'Nodos Firmantes'}`;
        // Animar un poco al actualizar
        counterEl.style.transform = 'scale(1.1)';
        setTimeout(() => counterEl.style.transform = 'scale(1)', 300);
    }
}

function renderSignatures(signatures) {
    const list = document.getElementById('signatures-list');
    list.innerHTML = '';

    signatures.forEach(sig => {
        addSignatureToDOM(sig, list);
    });
}

function addSignatureToDOM(sig, container = null) {
    const list = container || document.getElementById('signatures-list');
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
        <div class="card-name">${escapeHTML(sig.name)}</div>
        <div class="card-hash">${escapeHTML(sig.country || 'Desconocido')}</div>
        ${sig.comment ? `<div class="card-comment" style="font-size: 0.9rem; margin-bottom: 0.8rem; font-style: italic; opacity: 0.9; word-break: break-word;">"${escapeHTML(sig.comment)}"</div>` : ''}
        <div class="card-time">${new Date(sig.created_at).toLocaleString(currentLang)}</div>
    `;
    // Insertar al inicio si no es render base
    if (container) {
        list.appendChild(card);
    } else {
        list.insertBefore(card, list.firstChild);
        // Mantener el límite visual de 4 elementos máximo cuando entran nuevas firmas
        while (list.children.length > 4) {
            list.removeChild(list.lastChild);
        }
    }
}

// Suscripción Realtime a Supabase
function setupRealtime() {
    if (!supabaseClient || !CONFIG.SUPABASE_URL) return;

    supabaseClient
        .channel('public:signatures')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'signatures' }, payload => {
            // Se insertó una nueva firma, añadirla a la vista
            addSignatureToDOM(payload.new);

            // Actualizar contador manualmente
            const counterEl = document.getElementById('signature-count');
            if (counterEl) {
                const currentCount = parseInt(counterEl.textContent) || 0;
                updateCounter(currentCount + 1);
            }
        })
        .subscribe();
}

// Utilidades de Frontend
function setupForm() {
    const form = document.getElementById('sign-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = document.getElementById('signer-name').value;
        const country = document.getElementById('signer-country').value;
        const comment = document.getElementById('signer-comment').value;
        
        const honeypot = document.getElementById('signer-bot-catch').value;
        const userCaptcha = parseInt(document.getElementById('signer-captcha').value);

        if (honeypot !== '') {
            console.warn("Bot detected: honeypot filled.");
            return; // silently fail
        }

        if (userCaptcha !== captchaResult) {
            alert(dictionary['pow_error'] || "Respuesta incorrecta.");
            setupCaptcha();
            return;
        }

        if(!name || !country) return;

        const btn = form.querySelector('button[type="submit"]');
        const originalText = btn.textContent;
        btn.textContent = dictionary['pow_computing'] || 'Calculando Prueba Criptográfica...';
        btn.disabled = true;

        try {
            if(!supabaseClient || !CONFIG.SUPABASE_URL) {
                alert("Faltan credenciales válidas de base de datos distribuida en la configuración.");
                return;
            }

            // Pseudo Proof of Work para enlentecer bots
            await calculatePoW(name + country);

            const { error } = await supabaseClient
                .from('signatures')
                .insert([{ name, country, comment }]);

            if (error) throw error;

            // Como tenemos un realtime listener, la UI se actualizará sola.
            form.reset();
            setupCaptcha();
            alert(dictionary['pow_success'] || `Firma guardada en el registro global.\n\nNota: Has actuado sobre el consorcio distribuido interactuando directamente en PostgreSQL via Supabase.`);
        } catch (e) {
            console.error(e);
            alert("Hubo un error al registrar el nodo.");
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    });
}

let captchaResult = 0;
function setupCaptcha() {
    const num1 = Math.floor(Math.random() * 10) + 1;
    const num2 = Math.floor(Math.random() * 10) + 1;
    captchaResult = num1 + num2;
    const mathSpan = document.getElementById('math-problem');
    if(mathSpan) {
        mathSpan.textContent = `(${num1} + ${num2} = ?)`;
    }
    const capEl = document.getElementById('signer-captcha');
    if(capEl) capEl.value = '';
}

async function calculatePoW(context) {
    let nonce = 0;
    while (true) {
        for(let i=0; i<1500; i++) {
            const msgBuf = new TextEncoder().encode(context + nonce.toString());
            const hashBuf = await crypto.subtle.digest('SHA-1', msgBuf);
            const hashArray = new Uint8Array(hashBuf);
            if (hashArray[0] === 0 && hashArray[1] === 0) { 
                return nonce; 
            }
            nonce++;
        }
        await new Promise(r => setTimeout(r, 0)); // Evitar colgar el navegador
    }
}

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g,
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}
