# fish の設定の入口。中身は conf.d/ に役割ごとに分けて置く。
# fish は ~/.config/fish/conf.d/*.fish を名前順に読み、そのあとでこのファイルを読む。
# conf.d の各ファイルは mise-dotfiles の config/fish/conf.d/ から 1 つずつ symlink される。
# 先頭の番号は読み込む順番で、依存する側を大きくする。
