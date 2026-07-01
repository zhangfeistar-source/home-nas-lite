Unicode true

!macro customUnInstall
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
    "卸载程序不会删除你的家庭共享文件。$\r$\n$\r$\n卸载程序只会删除家庭 NAS 应用文件，不会删除您选择的家庭共享目录，也不会删除其中的任何文件。默认会保留 %APPDATA%\家庭NAS 中的配置、索引和日志，方便以后重新安装。是否同时删除这些应用数据？" \
    IDYES deleteHomeNasAppData \
    IDNO keepHomeNasAppData

  deleteHomeNasAppData:
  DetailPrint "正在删除家庭 NAS 应用配置、索引和日志…"
  RMDir /r "$APPDATA\家庭NAS"
  Goto homeNasDataCleanupDone

  keepHomeNasAppData:
    DetailPrint "已保留家庭 NAS 应用数据。家庭共享目录始终保留。"

  homeNasDataCleanupDone:
!macroend
