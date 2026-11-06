# NPASmart AI

A browser-based document image recognizer and PDF converter built with HTML, CSS and modular JavaScript.

## Features

- Demo administrator login (default username `Admin`, password `Admin`).
- Upload multiple JPG/JPEG/PNG images or capture a document with a camera.
- Per-image validation: 10 MB hard limit and 2.5 MB recommended size.
- OCR with Tesseract.js suggests a title and a date printed on the document.
- Review and edit the suggested title/date before saving.
- Creates one PDF per image using the original image as the PDF page.
- Does not crop, filter, sharpen, remove stamps, remove signatures, add OCR text, or otherwise edit the image.
- Saves PDFs, original images and metadata in IndexedDB.
- Organizes documents logically by the document date (year/month/day).
- Search, date filter, preview, download and delete.

## Run locally

This project uses browser ES modules, so open it through a local web server instead of double-clicking `index.html`.

### Option 1: Python

```bash
cd docusmart-ai
python -m http.server 8000
```

Open `http://localhost:8000` in Chrome, Edge or Firefox.

### Option 2: VS Code

1. Open the `docusmart-ai` folder in VS Code.
2. Install/enable the **Live Server** extension.
3. Right-click `index.html` and choose **Open with Live Server**.

The OCR and PDF libraries are loaded from public CDNs, so internet access is required for those libraries on first use. Camera access normally requires HTTPS or `localhost`.

## Default demo login

- Username: `Admin`
- Password: `Admin`

## Important security note

This is a front-end-only prototype. The demo credentials are in `js/auth.js` and can be discovered by anyone who can inspect the website's source. The session check is not secure authentication. Do not publish this version as a protected production service or store confidential documents in it. Before production, replace the demo login with Supabase Auth, enforce authorization with Supabase Row Level Security, and store documents in a private Supabase Storage bucket.

## Where documents are saved

The original image, generated PDF and searchable metadata are stored in the browser's IndexedDB database named `docusmart-ai-db`. They do not automatically sync to another computer. Clearing browser site data can delete these documents, so download and back up important PDFs.

The folder path shown in the metadata follows this pattern:

```text
Documents/YYYY/Month/DD-MM-YYYY/filename.pdf
```

Browsers do not let ordinary websites create arbitrary folders on the user's computer automatically. The app therefore stores the folder path as metadata and groups the document library by date. The downloaded PDF is saved to the user's normal Downloads location.

## Date recognition behavior

OCR suggestions can be imperfect. Every image opens a review step. Confirm the date shown on the document before saving; when OCR does not find a date, the date field defaults to today's date as a placeholder and must be corrected when appropriate. Numeric dates are interpreted using day/month/year where possible, which suits common Nigerian document formats.

## Image preservation behavior

The OCR engine reads the image only to suggest metadata. `pdfGenerator.js` embeds the original uploaded image into a PDF page without image cleanup, perspective correction, compression, cropping or OCR overlays. A PDF is a container, so its file size may differ from the source image size.

## Project structure

```text
docusmart-ai/
├── index.html
├── README.md
├── css/
│   └── style.css
└── js/
    ├── app.js
    ├── auth.js
    ├── config.js
    ├── modules/
    │   ├── camera.js
    │   ├── database.js
    │   ├── dateExtractor.js
    │   ├── documentManager.js
    │   ├── fileOrganizer.js
    │   ├── fileValidator.js
    │   ├── ocrEngine.js
    │   ├── pdfGenerator.js
    │   └── titleExtractor.js
    └── utils/
        └── fileName.js
```

## Future Supabase integration

The code separates recognition, PDF creation, storage, validation and organization into modules. For a later Supabase migration:

1. Replace `auth.js` with Supabase Auth.
2. Replace `database.js` with Supabase database and private Storage operations.
3. Add RLS policies so only authorized users can view or manage their documents.
4. Upload the generated PDF and original image to private storage paths based on the extracted date.
5. Keep OCR and PDF generation modules reusable, or move OCR to a server/Edge Function if larger-scale processing is needed.
