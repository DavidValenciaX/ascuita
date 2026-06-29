/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { create } from 'zustand';

export type Language = 'en' | 'es';

type Translations = {
    [key in Language]: {
        [key: string]: string;
    };
};

export const translations: Translations = {
    en: {
        // Header
        language: 'English',
        defaultAgentName: 'Ascuita',
        edit: 'Edit',
        deleteAgent: 'Delete',
        deleteAgentConfirm: 'Delete this agent? This cannot be undone.',
        presets: 'Presets',
        yourAgents: 'Your agents',
        noneYet: 'None yet.',
        newAgent: 'New agent',
        saveAgent: 'Save & select',
        agentNameRequired: 'Please enter a name for the agent.',
        agentPersonalityRequired: 'Please enter a personality description.',
        yourName: 'Your name',
        settings: 'Settings',
        // UserSettings
        userSettingsTitle:
            'This is a simple tool that allows you to design, test, and banter with custom AI characters on the fly.',
        optionalInfo: 'Adding this optional info makes the experience more fun:',
        yourInfo: 'Your info',
        namePlaceholder: 'What do you like to be called?',
        infoPlaceholder:
            'Things we should know about you… Likes, dislikes, hobbies, interests, favorite movies, books, tv shows, foods, etc.',
        profileAccountDesc: 'This information comes from your Firebase/Google account and is synced automatically.',
        profileOptionalDesc: 'These optional fields are specific to Ascuita. Only save them if you want a more personalized experience.',
        profileProvider: 'Sign-in provider',
        profileProviderGoogle: 'Google',
        profileProviderPassword: 'Email and password',
        profileEmailStatus: 'Email status',
        profileEmailVerified: 'Verified',
        profileEmailNotVerified: 'Not verified',
        profileFirebaseName: 'Account name',
        profileUnavailable: 'Not available',
        profilePhotoAlt: 'Profile photo',
        profileNickname: 'How Ascuita should call you',
        profileNicknamePlaceholder: 'Optional nickname or preferred name',
        profileAboutYou: 'Optional information about you',
        profileAboutYouPlaceholder: 'Optional context such as interests, preferences, hobbies, goals, or things you want Ascuita to remember about you.',
        letsGo: 'Let’s go!',
        // EditAgent
        name: 'Name',
        personality: 'Personality',
        personalityPlaceholder:
            'How should I act? Whatʼs my purpose? How would you describe my personality?',
        voice: 'Voice',
        selectColor: 'Select color',
        // SettingsPanel
        settingsPanelTitle: 'Settings',
        tabProfile: 'Profile',
        tabAgent: 'Agent',
        tabAgents: 'Agents',
        tabSpeech: 'Speech',
        tabAppearance: 'Appearance',
        tabLanguage: 'Language',
        tabChats: 'Chats',
        chatsTitle: 'Conversation history',
        chatsDesc: 'Your past conversations with the avatar.',
        chatsEmpty: 'No conversations yet. Start talking to create one.',
        chatsMessages: 'messages',
        chatsActive: 'Active',
        chatsEnded: 'Ended',
        chatsDelete: 'Delete',
        chatsView: 'View messages',
        chatsResume: 'Resume',
        chatsResumeHint: 'Resume this chat with the same conversation context and continue from where it stopped.',
        chatsBack: 'Back to list',
        chatsDeleteDisabled: 'Active conversations can only be deleted after they end.',
        chatsDeleteConfirm: 'Delete this conversation? This cannot be undone.',
        chatsLoading: 'Loading messages...',
        chatsNoMessages: 'No messages in this conversation.',
        chatsYou: 'You',
        chatsAssistant: 'Assistant',
        newChat: 'New chat',
        toggleSidebar: 'Toggle chat history',
        sceneTheme: '3D space theme',
        sceneThemeDesc: 'Choose the default basic space behind the avatar.',
        sceneThemeLight: 'Light studio: soft, bright, and warm.',
        sceneThemeDark: 'Dark studio: the cozy space.',
        // ControlTray
        connecting: 'Connecting',
        connectionError: 'Connection error',
        wsBlockedError: 'WebSocket blocked. Disable Brave Shields or ad blockers for this site.',
        preparingGreeting: 'Preparing greeting',
        signInRequired: 'Sign in required',
        streaming: 'Streaming',
        continueWithGoogle: 'Continue with Google',
        signingIn: 'Signing in...',
        trialEndedEyebrow: 'Free access finished',
        trialEndedTitle: 'Sign in to keep talking',
        trialEndedBody:
            'The free trial has ended. Sign in with Google to continue talking with the avatar.',
        // ErrorScreen
        errorGeneric: 'Something went wrong. Please try again.',
        errorQuota:
            'Gemini Live API in AI Studio has a limited free quota each day. Come back tomorrow to continue.',
        close: 'Close',
        // Legal
        legalTitle: 'Legal',
        legalPrivacy: 'Privacy Policy',
        legalTerms: 'Terms of Service',
        clickwrapAcceptTerms: 'I accept the Terms of Service.',
        clickwrapReadPrivacy: 'I have read and understand the Privacy Policy.',
        clickwrapRequired: 'Required',
    },
    es: {
        // Header
        language: 'Español',
        defaultAgentName: 'Ascuita',
        edit: 'Editar',
        deleteAgent: 'Eliminar',
        deleteAgentConfirm: '¿Eliminar este agente? Esta acción no se puede deshacer.',
        presets: 'Preajustes',
        yourAgents: 'Tus agentes',
        noneYet: 'Aún no hay ninguno.',
        newAgent: 'Nuevo agente',
        saveAgent: 'Guardar y seleccionar',
        agentNameRequired: 'Por favor, ingresa un nombre para el agente.',
        agentPersonalityRequired: 'Por favor, ingresa una descripción de personalidad.',
        yourName: 'Tu nombre',
        settings: 'Configuración',
        // UserSettings
        userSettingsTitle:
            'Esta es una herramienta sencilla que te permite diseñar, probar y charlar con personajes de IA personalizados sobre la marcha.',
        optionalInfo: 'Agregar esta información opcional hace que la experiencia sea más divertida:',
        yourInfo: 'Tu información',
        namePlaceholder: '¿Cómo te gustaría que te llamen?',
        infoPlaceholder:
            'Cosas que deberíamos saber sobre ti... Gustos, aversiones, pasatiempos, intereses, películas favoritas, libros, programas de televisión, comidas, etc.',
        profileAccountDesc: 'Esta información viene de tu cuenta de Firebase/Google y se sincroniza automáticamente.',
        profileOptionalDesc: 'Estos campos opcionales son propios de Ascuita. Solo guárdalos si quieres una experiencia más personalizada.',
        profileProvider: 'Proveedor de acceso',
        profileProviderGoogle: 'Google',
        profileProviderPassword: 'Correo y contraseña',
        profileEmailStatus: 'Estado del correo',
        profileEmailVerified: 'Verificado',
        profileEmailNotVerified: 'No verificado',
        profileFirebaseName: 'Nombre de la cuenta',
        profileUnavailable: 'No disponible',
        profilePhotoAlt: 'Foto de perfil',
        profileNickname: 'Cómo quieres que Ascuita te llame',
        profileNicknamePlaceholder: 'Apodo o nombre preferido opcional',
        profileAboutYou: 'Información opcional sobre ti',
        profileAboutYouPlaceholder: 'Contexto opcional como intereses, preferencias, hobbies, objetivos o cosas que quieras que Ascuita recuerde sobre ti.',
        letsGo: '¡Vamos!',
        // EditAgent
        name: 'Nombre',
        personality: 'Personalidad',
        personalityPlaceholder:
            '¿Cómo debo actuar? ¿Cuál es mi propósito? ¿Cómo describirías mi personalidad?',
        voice: 'Voz',
        selectColor: 'Seleccionar color',
        // SettingsPanel
        settingsPanelTitle: 'Configuración',
        tabProfile: 'Perfil',
        tabAgent: 'Agente',
        tabAgents: 'Agentes',
        tabSpeech: 'Habla',
        tabAppearance: 'Apariencia',
        tabLanguage: 'Idioma',
        tabChats: 'Chats',
        chatsTitle: 'Historial de conversaciones',
        chatsDesc: 'Tus conversaciones anteriores con el avatar.',
        chatsEmpty: 'Aún no hay conversaciones. Empieza a hablar para crear una.',
        chatsMessages: 'mensajes',
        chatsActive: 'Activa',
        chatsEnded: 'Finalizada',
        chatsDelete: 'Eliminar',
        chatsView: 'Ver mensajes',
        chatsResume: 'Retomar',
        chatsResumeHint: 'Retoma este chat con el mismo contexto de conversación y continúa desde donde se quedó.',
        chatsBack: 'Volver a la lista',
        chatsDeleteDisabled: 'Las conversaciones activas solo se pueden eliminar cuando terminan.',
        chatsDeleteConfirm: '¿Eliminar esta conversación? Esta acción no se puede deshacer.',
        chatsLoading: 'Cargando mensajes...',
        chatsNoMessages: 'No hay mensajes en esta conversación.',
        chatsYou: 'Tú',
        chatsAssistant: 'Asistente',
        newChat: 'Nuevo chat',
        toggleSidebar: 'Mostrar/ocultar historial',
        sceneTheme: 'Tema del espacio 3D',
        sceneThemeDesc: 'Elige el espacio básico que aparece detrás del avatar.',
        sceneThemeLight: 'Estudio claro: suave, luminoso y cálido.',
        sceneThemeDark: 'Estudio oscuro: el espacio acogedor.',
        // ControlTray
        connecting: 'Conectando',
        connectionError: 'Error de conexión',
        wsBlockedError: 'WebSocket bloqueado. Desactiva Brave Shields o bloqueadores de anuncios para este sitio.',
        preparingGreeting: 'Preparando saludo',
        signInRequired: 'Inicia sesión para continuar',
        streaming: 'Transmitiendo',
        continueWithGoogle: 'Continuar con Google',
        signingIn: 'Iniciando sesión...',
        trialEndedEyebrow: 'Acceso gratuito terminado',
        trialEndedTitle: 'Inicia sesión para seguir hablando',
        trialEndedBody:
            'La prueba gratuita ya terminó. Inicia sesión con Google para seguir conversando con el avatar.',
        // ErrorScreen
        errorGeneric: 'Algo salió mal. Por favor, inténtalo de nuevo.',
        errorQuota:
            'La API de Gemini Live en AI Studio tiene una cuota gratuita limitada cada día. Vuelve mañana para continuar.',
        close: 'Cerrar',
        // Legal
        legalTitle: 'Legal',
        legalPrivacy: 'Política de Privacidad',
        legalTerms: 'Términos y Condiciones',
        clickwrapAcceptTerms: 'Acepto los Términos y Condiciones.',
        clickwrapReadPrivacy: 'He leído y comprendo la Política de Privacidad.',
        clickwrapRequired: 'Obligatorio',
    },
};

const getInitialLanguage = (): Language => {
    if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('ascuita-lang');
        if (stored === 'en' || stored === 'es') return stored;
    }
    if (typeof navigator === 'undefined') return 'es';
    return navigator.language.startsWith('es') ? 'es' : 'en';
};

export const useLanguage = create<{
    language: Language;
    setLanguage: (language: Language) => void;
    t: (key: string) => string;
}>(set => ({
    language: getInitialLanguage(),
    setLanguage: (language: Language) => {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('ascuita-lang', language);
        }
        set({ language });
    },
    t: (key: string) => {
        // We access the state inside the function to get the current language
        // But since this is inside the store creator, we can't easily access 'get'.
        // A common pattern with Zustand for this simple case is just exposing the dictionary
        // or a hook wrapper.
        // Let's simplify: return the dictionary object in the component instead of a t function here
        // or use a separate hook.
        return key;
    },
}));

// Helper hook to get translations
export function useTranslation() {
    const { language, setLanguage } = useLanguage();
    return {
        language,
        setLanguage,
        t: (key: keyof typeof translations['en']) => translations[language][key],
    };
}
