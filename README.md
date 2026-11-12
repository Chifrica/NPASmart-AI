# NPASmart AI

A browser-based document image recognizer and PDF converter built with HTML, CSS and modular JavaScript.

## Features

- Demo administrator login (default username `Admin`, password `Admin`).
- Upload multiple JPG/JPEG/PNG images or capture a document with a camera.
- Detects page edges and corrects perspective when possible, then enhances monochrome text and page background.
- Provides a crop review tool if automatic page detection misses the page.
- Suggests the Subject, reference number and written date from OCR; review and edit these before saving.
- Create named folders and assign documents to them.
- Per-image validation: 10 MB hard limit and 2.5 MB recommended size.
- OCR with Tesseract.js suggests the Subject, reference number and date printed on the document.
- Review and edit the suggested title/date before saving.
- Creates one PDF per image using the reviewed, processed image as the PDF page.
- Enhances low-saturation text and paper to black and white while retaining detected colored marks such as stamps.
- OCR text is used only for suggestions and is never added to the PDF page.
- Saves PDFs, original images and metadata in IndexedDB.
- Organizes documents by date metadata and optional named folders.
- Search by subject, reference number, recognized text or date; filter by folder and document date.

## Run locally

This project uses browser ES modules, so open it through a local web server instead of double-clicking `index.html`.

### Option 1: Python

```bash
cd NPASmart-AI
python -m http.server 8000
```

Open `http://localhost:8000` in Chrome, Edge or Firefox.

### Option 2: VS Code

1. Open the `NPASmart-AI` folder in VS Code.
2. Install/enable the **Live Server** extension.
3. Right-click `index.html` and choose **Open with Live Server**.

The OCR and PDF libraries are loaded from public CDNs. OpenCV.js is also loaded on demand for automatic page detection, so internet access is required for full automatic processing. If OpenCV cannot load, image contrast enhancement and manual rectangular cropping remain available. Camera access normally requires HTTPS or `localhost`.

## Default demo login

- Username: `Admin`
- Password: `Admin`

## Important security note

This is a front-end-only prototype. The demo credentials are in `js/auth.js` and can be discovered by anyone who can inspect the website's source. The session check is not secure authentication. Do not publish this version as a protected production service or store confidential documents in it. Before production, replace the demo login with Supabase Auth, enforce authorization with Supabase Row Level Security, and store documents in a private Supabase Storage bucket.

## Where documents are saved

The original image, generated PDF, searchable metadata and user-created folders are stored in the browser's IndexedDB database named `docusmart-ai-db`. The PDF contains the reviewed enhanced image; the original upload is also retained in local storage. Documents do not automatically sync to another computer or upload to GitHub. Clearing browser site data can delete these documents, so download and back up important PDFs.

The date-based folder path shown in the metadata follows this pattern:

```text
Documents/YYYY/Month/DD-MM-YYYY/filename.pdf
```

Named folders created in the app are local library groupings, not folders on the computer's disk. Browsers do not let ordinary websites create arbitrary folders on the user's computer automatically. The downloaded PDF is saved to the user's normal Downloads location.

## Date recognition behavior

OCR suggestions can be imperfect. Every image opens a review step. The app looks for a printed Subject, reference number and date; confirm or correct them before saving. A date is required and is never silently replaced with the upload date. Numeric dates are interpreted using day/month/year where possible, which suits common Nigerian document formats.

## Image cleanup behavior

The OCR engine reads the uploaded image only to suggest metadata. The image processor attempts page-edge detection and perspective correction, then applies adaptive black-and-white enhancement to low-saturation regions while retaining detected colored pixels. Inspect the preview, use the rectangular crop tool or restore the full frame when automatic detection is incorrect, and verify that stamps and signatures look right before saving. Image processing is heuristic and may need manual review.

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
    │   ├── imageProcessor.js
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
