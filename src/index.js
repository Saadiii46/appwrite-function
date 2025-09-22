const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const mime = require("mime-types");
const sdk = require("node-appwrite");

module.exports = async function (req) {
  console.log("Starting function… (Node 22 uploader, CJS)");

  try {
    // ---------------------------
    // Debug: Log entire request object structure
    // ---------------------------
    console.log("Request object keys:", Object.keys(req));
    console.log("Request body:", req.body);
    console.log("Request payload:", req.payload);
    console.log("Request bodyRaw:", req.bodyRaw);

    // ---------------------------
    // Parse Payload - For functions.createExecution()
    // ---------------------------
    let payload = {};

    // When using functions.createExecution(functionId, data),
    // the data is available in req.body or req.bodyRaw
    if (req.body) {
      payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } else if (req.bodyRaw) {
      payload = JSON.parse(req.bodyRaw);
    } else if (req.payload) {
      payload = JSON.parse(req.payload);
    }

    console.log("Final parsed payload:", payload);

    const fileId = payload.fileId;
    const projectSlug = payload.projectSlug;

    if (!fileId || !projectSlug) {
      throw new Error("Missing fileId or projectSlug in payload");
    }

    const bucketId = process.env.UNIFIED_BUCKET_ID;
    if (!bucketId) {
      throw new Error("Missing UNIFIED_BUCKET_ID env var");
    }

    console.log(
      `Payload OK: fileId=${fileId}, projectSlug=${projectSlug}, bucket=${bucketId}`
    );

    // ---------------------------
    // Init Appwrite Client
    // ---------------------------
    const client = new sdk.Client()
      .setEndpoint(process.env.APPWRITE_ENDPOINT)
      .setProject(process.env.APPWRITE_PROJECT_ID)
      .setKey(process.env.APPWRITE_API_KEY);

    const storage = new sdk.Storage(client);

    // ---------------------------
    // Download zip
    // ---------------------------
    console.log("Downloading zip file from storage…");
    const zipFile = await storage.getFileDownload(bucketId, fileId);
    const zipPath = `/tmp/${fileId}.zip`;
    fs.writeFileSync(zipPath, Buffer.from(await zipFile.arrayBuffer()));

    // ---------------------------
    // Extract zip
    // ---------------------------
    console.log("Extracting zip…");
    const zip = new AdmZip(zipPath);
    zip.extractAllTo("/tmp/extracted", true);

    const extractedFiles = fs.readdirSync("/tmp/extracted");
    console.log("Files extracted (count):", extractedFiles.length);

    // ---------------------------
    // Helper: Upload file
    // ---------------------------
    async function tryUpload(filePath, fileName) {
      const fileBuffer = fs.readFileSync(filePath);
      const mimeType = mime.lookup(fileName) || "application/octet-stream";

      return await storage.createFile(bucketId, "unique()", {
        type: mimeType,
        size: fileBuffer.length,
        name: fileName,
        buffer: fileBuffer,
      });
    }

    // ---------------------------
    // Upload extracted files
    // ---------------------------
    const uploadedFiles = [];
    for (const fileName of extractedFiles) {
      const localPath = path.join("/tmp/extracted", fileName);
      console.log("Uploading:", fileName);

      try {
        const uploaded = await tryUpload(localPath, fileName);
        console.log("Uploaded OK:", uploaded.$id);
        uploadedFiles.push(uploaded.$id);
      } catch (err) {
        console.error(`Upload failed for ${fileName}`, err);
      }
    }

    // ✅ SUCCESS RESPONSE
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ success: true, files: uploadedFiles }),
    };
  } catch (err) {
    console.error("Function error:", err);

    // ❌ ERROR RESPONSE
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
