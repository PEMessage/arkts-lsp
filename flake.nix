{
  description = "arkts-lsp: standalone ArkTS language server (extractor + proxy)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
  };

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      devShells.${system}.default = pkgs.mkShell {
        nativeBuildInputs = with pkgs; [
          nodejs_22
          p7zip    # extract .dmg inside devecostudio-mac-*.zip
          unzip
          bsdtar
          curl
          jq
        ];

        shellHook = ''
          echo "arkts-lsp dev shell"
          echo "  Node.js : $(node --version)"
          echo "  extract : node extractor/extract-ace-server.mjs --help"
          echo "  build   : npm install && npm test"
        '';
      };
    };
}
