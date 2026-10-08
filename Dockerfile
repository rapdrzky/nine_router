FROM decolua/9router:0.5.95@sha256:4316fefb95ea642d57db885d906b1227b1768b15ac5def314621fd781da7b3f1

COPY patch_opencode_nine_router.js /app/

CMD ["node", "/app/patch_opencode_nine_router.js", "--start"]
