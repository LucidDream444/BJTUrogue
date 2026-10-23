from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import CloudSaveReadSerializer, CloudSaveUploadSerializer
from .services import CloudSaveService, SaveConflictError


class CloudSaveView(APIView):
    """云存档：GET 拉取、PUT 上传（乐观并发）、DELETE 清除。全部需要 JWT。

    对齐 `docs/云存档接口草案.md`：`base_revision` 落后返回 409，客户端据此 GET 比对
    revision 自行合并，服务端不静默覆盖。
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: CloudSaveReadSerializer, 404: None})
    def get(self, request):
        save = CloudSaveService.get(request.user)
        if save is None:
            return Response({"detail": "还没有云存档"}, status=status.HTTP_404_NOT_FOUND)
        return Response(CloudSaveReadSerializer(save).data)

    @extend_schema(
        request=CloudSaveUploadSerializer,
        responses={200: CloudSaveReadSerializer, 409: None},
    )
    def put(self, request):
        ser = CloudSaveUploadSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            save = CloudSaveService.upload(
                request.user,
                profile=ser.validated_data["profile"],
                base_revision=ser.validated_data["base_revision"],
            )
        except SaveConflictError as e:
            current = CloudSaveService.get(request.user)
            return Response(
                {
                    "detail": "云端已被其他设备更新，请先拉取后合并再上传",
                    "revision": e.current_revision,
                    "updated_at": current.updated_at if current else None,
                },
                status=status.HTTP_409_CONFLICT,
            )
        return Response(CloudSaveReadSerializer(save).data)

    @extend_schema(responses={204: None})
    def delete(self, request):
        CloudSaveService.delete(request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)
