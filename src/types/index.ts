export interface Tweet {
    id: string;
    text: string;
    createdAt: Date;
    user: {
        id: string;
        username: string;
        displayName: string;
    };
}

export interface Translation {
    originalText: string;
    translatedText: string;
    language: string;
}