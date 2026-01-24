import type { ApplicationDefinitionInterface } from "@workadventure/messages";
import { config } from "../config/env";

export function buildApplications(): ApplicationDefinitionInterface[] {
    const applications: ApplicationDefinitionInterface[] = [];

    if (config.KLAXOON_ENABLED) {
        applications.push({
            name: "Klaxoon",
            doc: "https://klaxoon.com",
            image: "https://static.klaxoon.com/favicon.ico",
            description: "Klaxoon (Brainstorming, Quiz, Survey)",
            enabled: true,
            default: true,
            forceNewTab: false,
            allowAPI: false,
        });
    }

    if (config.YOUTUBE_ENABLED) {
        applications.push({
            name: "Youtube",
            doc: "https://youtube.com",
            image: "https://www.youtube.com/favicon.ico",
            description: "Youtube (Video sharing)",
            enabled: true,
            default: true,
            forceNewTab: false,
            allowAPI: false,
        });
    }

    if (config.GOOGLE_DRIVE_ENABLED) {
        applications.push({
            name: "Google Drive",
            doc: "https://drive.google.com",
            description: "Google Drive (Docs, Sheets, Slides)",
            enabled: true,
            default: true,
            forceNewTab: false,
            allowAPI: false,
        });
    }

    if (config.GOOGLE_DOCS_ENABLED) {
        applications.push({
            name: "Google Docs",
            doc: "https://docs.google.com",
            description: "Google Docs (Word Processor)",
            enabled: true,
            default: true,
            forceNewTab: false,
            allowAPI: false,
        });
    }

    if (config.GOOGLE_SHEETS_ENABLED) {
        applications.push({
            name: "Google Sheets",
            doc: "https://sheets.google.com",
            description: "Google Sheets (Spreadsheet)",
            enabled: true,
            default: true,
            forceNewTab: false,
            allowAPI: false,
        });
    }

    if (config.GOOGLE_SLIDES_ENABLED) {
        applications.push({
            name: "Google Slides",
            doc: "https://slides.google.com",
            description: "Google Slides (Presentation)",
            enabled: true,
            default: true,
            forceNewTab: false,
            allowAPI: false,
        });
    }

    if (config.ERASER_ENABLED) {
        applications.push({
            name: "Eraser",
            doc: "https://workadventu.re",
            description: "Eraser (White board)",
            enabled: true,
            default: true,
            forceNewTab: false,
            allowAPI: false,
        });
    }

    if (config.EXCALIDRAW_ENABLED) {
        applications.push({
            name: "Excalidraw",
            doc: "https://excalidraw.com",
            description: "Excalidraw (White board)",
            enabled: true,
            default: true,
            forceNewTab: false,
            allowAPI: false,
        });
    }

    if (config.CARDS_ENABLED) {
        applications.push({
            name: "Cards",
            doc: "https://workadventu.re",
            description: "Cards (learning tool)",
            enabled: true,
            default: true,
            forceNewTab: false,
            allowAPI: false,
        });
    }

    if (config.TLDRAW_ENABLED) {
        applications.push({
            name: "tldraw",
            doc: "https://tldraw.com",
            description: "tldraw (White board)",
            enabled: true,
            default: true,
            forceNewTab: false,
            allowAPI: false,
        });
    }

    return applications;
}
