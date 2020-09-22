// multiparty does the heavy lifting for up parsing form data from the request
const multiparty = require('multiparty');
// file-type reads the file type from any files uploaded into the form
const fileType = require('file-type');
// fs reads the file data out of the body into a "buffer" stream
const fs = require('fs');

const { uploadFile } = require('../../lib/awsBucket');

const fileUploadHandler = async (req, res, next) => {
  // Create a new instance of a multiparty form object
  const form = new multiparty.Form();
  // Parse the form data from the request body into multiparty
  form.parse(req, async (error, fields, files) => {
    // Check for basic error cases
    if (error) throw new Error(error);

    // Iterate over the request body and parse all form data
    try {
      // Get a list of all form fields that had file uploads
      const fileNames = Object.keys(files);

      // Initiate a hash table to store resolved file upload values
      const resolvedFiles = {};

      // Check each field, and upload however many files were in each input
      for await (const f of fileNames) {
        // Get the path of each file
        const paths = files[f].map((x) => x.path);

        // Read each file into a buffer
        const buffers = paths.map((path) => fs.readFileSync(path));

        // Create a list of promises to find each file type and resolve them
        const typePromises = buffers.map((buffer) =>
          fileType.fromBuffer(buffer)
        );
        const types = await Promise.all(typePromises);

        // Generate unique names for each file
        const uploadFileNames = paths.map((path) => {
          const timestamp = Date.now().toString();
          return `bucketFolder/${timestamp}-lg-${path}`;
        });

        // Create a list of promises that upload files to the S3 bucket
        const promiseList = files[f].map((_, i) => {
          return uploadFile(buffers[i], uploadFileNames[i], types[i]);
        });

        // Resolve those promises and store them in the hash table with key being the form input value
        const resolved = await Promise.all(promiseList);
        resolvedFiles[f] = resolved;
      }

      // Pull the non-file form inputs into a hash table
      const formInputs = {};
      Object.keys(fields).forEach((x) => {
        formInputs[x] = fields[x][0];
      });

      // Add the resolved file objects and the standard inputs into the request body
      req.body = {
        ...req.body,
        ...formInputs,
        ...resolvedFiles,
      };

      // Continue to router
      next();
    } catch (err) {
      // There was an error with the S3 upload
      res.status(500).json({ err, message: 'File upload failed. Try again.' });
    }
  });
};

module.exports = {
  fileUploadHandler,
};
