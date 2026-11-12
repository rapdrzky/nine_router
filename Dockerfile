FROM decolua/9router:0.5.116@sha256:12086f97857f784ab7762e95595f70d71279a7a60c800af0f100183e8da7ea36

COPY patch_opencode_nine_router.js /app/

CMD ["node", "/app/patch_opencode_nine_router.js", "--start"]
