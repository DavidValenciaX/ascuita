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
        presets: 'Presets',
        yourAgents: 'Your agents',
        noneYet: 'None yet.',
        newAgent: 'New agent',
        saveAgent: 'Save & select',
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
        sceneTheme: '3D space theme',
        sceneThemeDesc: 'Choose the default basic space behind the avatar.',
        sceneThemeLight: 'Light studio: soft, bright, and warm.',
        sceneThemeDark: 'Dark studio: the cozy space.',
        // ControlTray
        connecting: 'Connecting',
        streaming: 'Streaming',
        // ErrorScreen
        errorGeneric: 'Something went wrong. Please try again.',
        errorQuota:
            'Gemini Live API in AI Studio has a limited free quota each day. Come back tomorrow to continue.',
        close: 'Close',
    },
    es: {
        // Header
        language: 'Español',
        defaultAgentName: 'Ascuita',
        edit: 'Editar',
        presets: 'Preajustes',
        yourAgents: 'Tus agentes',
        noneYet: 'Aún no hay ninguno.',
        newAgent: 'Nuevo agente',
        saveAgent: 'Guardar y seleccionar',
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
        sceneTheme: 'Tema del espacio 3D',
        sceneThemeDesc: 'Elige el espacio basico que aparece detras del avatar.',
        sceneThemeLight: 'Estudio claro: suave, luminoso y calido.',
        sceneThemeDark: 'Estudio oscuro: el espacio acogedor.',
        // ControlTray
        connecting: 'Conectando',
        streaming: 'Transmitiendo',
        // ErrorScreen
        errorGeneric: 'Algo salió mal. Por favor, inténtalo de nuevo.',
        errorQuota:
            'La API de Gemini Live en AI Studio tiene una cuota gratuita limitada cada día. Vuelve mañana para continuar.',
        close: 'Cerrar',
    },
};

const getInitialLanguage = (): Language => {
    if (typeof navigator === 'undefined') return 'es';
    return navigator.language.startsWith('es') ? 'es' : 'en';
};

export const useLanguage = create<{
    language: Language;
    setLanguage: (language: Language) => void;
    t: (key: string) => string;
}>(set => ({
    language: getInitialLanguage(),
    setLanguage: (language: Language) => set({ language }),
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
