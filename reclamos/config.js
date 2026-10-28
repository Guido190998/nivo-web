/* Configuración del Libro de Reclamaciones de Nivo.
   La clave «anon» es pública por diseño: solo permite lo que las funciones del servidor autorizan. */
window.LR_CONFIG = {
  supabaseUrl: "https://uvotorqggfqaadijpvte.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2b3RvcnFnZ2ZxYWFkaWpwdnRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzOTA1MzYsImV4cCI6MjEwNjk2NjUzNn0._qIeU2XbK39zztcR405g9cjAe34M9WzK2-wTgxH1nz4",
  funcion: "reclamos",
  // Dominios internos con los que el personal de cada app entra con usuario (sin correo).
  dominiosUsuarios: [
    "usuarios.plataforma-pedidos.app",
    "usuarios.pedidos-mayoristas.app",
    "usuarios.agenda-consejeria.app",
    "usuarios.ruta-del-dia.app",
    "usuarios.fidelizacion.app"
  ],
  maxAdjuntos: 3,
  maxPesoAdjunto: 5 * 1024 * 1024
};
